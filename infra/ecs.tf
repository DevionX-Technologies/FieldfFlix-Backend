locals {
  container_name = "${var.app_name}-backend"
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true

      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]

      # Plaintext config + DB_HOST (known only after RDS exists).
      environment = [
        for k, v in merge(local.app_environment, { DB_HOST = aws_db_instance.main.address }) :
        { name = k, value = tostring(v) }
      ]

      # Secrets injected from SSM SecureString at runtime.
      secrets = concat(
        [{ name = "DB_PASSWORD", valueFrom = aws_ssm_parameter.db_password.arn }],
        [for k in local.app_secret_keys : { name = k, valueFrom = aws_ssm_parameter.app_secret[k].arn }]
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "app"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.service_desired_count
  launch_type     = "FARGATE"

  # No NAT: tasks sit in public subnets with a public IP for outbound.
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  # Migrations run on boot (start:prodecs) — give the task time before health checks fail it.
  health_check_grace_period_seconds = 180

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]

  lifecycle {
    # Autoscaling manages desired_count; CI redeploys the same task def via
    # force-new-deployment, so don't let TF fight either.
    ignore_changes = [desired_count]
  }
}

# --- Autoscaling on CPU ---
resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.service_max_count
  min_capacity       = var.service_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "${local.name_prefix}-cpu-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
