# FieldFlicks infrastructure (Terraform, ap-south-1)

Cost-optimized production stack for the NestJS backend. Design rationale is in
the plan; this is the run book.

## What Terraform manages
VPC (no NAT — tasks in public subnets, S3 gateway endpoint) · ECR · S3 media
buckets · RDS Postgres 16 (t4g.micro) · ALB + ACM (HTTPS) · ECS Fargate service
+ autoscaling · CloudFront over media · SSM secret params · IAM (task/exec roles,
GitHub OIDC deploy role, admin user) · Budgets + Cost Anomaly Detection.

**Not** managed here: the 3 Lambdas + SQS queue — those stay on the Serverless
Framework (`serverless.yml`). Terraform creates the media bucket the Serverless
S3 notification attaches to, so run Terraform first.

## Prerequisites
- Terraform ≥ 1.6, AWS CLI configured for the target account.
- An API domain you control (DNS managed anywhere).

## Deploy order

### 0. (once) Retire root keys
After the first full apply, create credentials for the `fieldflicks-admin` IAM
user, reconfigure the CLI to use them, and delete the account root access keys.

### 1. Bootstrap remote state
```bash
cd infra/bootstrap
terraform init && terraform apply
cd ..
terraform init      # uses backend.tf → the bucket just created
```

### 2. Configure vars
```bash
cp terraform.tfvars.example terraform.tfvars
# edit domain_name, github_repo, alert_email
```

### 3. Issue the ACM cert (DNS is external)
```bash
terraform apply -target=aws_acm_certificate.api
terraform output acm_validation_records   # add these CNAMEs to your DNS
```

### 4. Seed app secrets in SSM
Terraform created the parameter KEYS with a `REPLACE_ME` placeholder. Set the
real values (repeat per key; Terraform won't overwrite them again):
```bash
for k in MUX_TOKEN_ID MUX_TOKEN_SECRET MUX_SIGNING_KEY_ID MUX_PRIVATE_KEY \
         FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY FIREBASE_APP_CHECK_DEBUG_TOKEN \
         FAST2SMS_AUTHORIZATION RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET SMTP_PASS; do
  echo "set /fieldflicks/production/$k"
done
aws ssm put-parameter --name /fieldflicks/production/MUX_TOKEN_ID \
  --type SecureString --value 'REAL_VALUE' --overwrite
# ... one per key
```
(`DB_PASSWORD` and `DB_HOST` are managed by Terraform — leave them alone.)

### 5. Full apply
```bash
terraform apply    # waits for cert validation, then builds ALB/ECS/etc.
```

### 6. Recreate Lambda layers + deploy Serverless
The `serverless.yml` layer ARNs point at the OLD account. Republish the two
layers in this account and update the ARNs (account id → 697589241071), then:
```bash
serverless deploy --stage production --region ap-south-1
```

### 7. First app deploy & DNS cutover
- Add GitHub repo variables from the outputs: `AWS_DEPLOY_ROLE` (=`github_deploy_role_arn`),
  `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`.
- Push to `main` → CI builds, pushes to ECR, force-deploys ECS.
- Point `domain_name` (CNAME) at `alb_dns_name`.

## Verify
```bash
curl -I https://<domain_name>/                 # 200 + build headers
aws ecs describe-services --cluster <cluster> --services <service> \
  --query 'services[0].{running:runningCount,desired:desiredCount,status:status}'
```

## Cost knobs
`service_desired_count`, `task_cpu/memory`, `db_instance_class` in tfvars.
Budget threshold: `monthly_budget_usd`. No NAT Gateway by design.
