const {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ListTasksCommand,
} = require('@aws-sdk/client-ecs');

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

const ecsClient = new ECSClient({ region: process.env.AWS_REGION });

async function main() {
  try {
    console.log('Listing ECS Clusters...');
    const clustersResponse = await ecsClient.send(new ListClustersCommand({}));
    const clusterArns = clustersResponse.clusterArns || [];
    console.log('Clusters found:', clusterArns);

    for (const clusterArn of clusterArns) {
      console.log(`\n--- Cluster: ${clusterArn} ---`);

      const servicesResponse = await ecsClient.send(
        new ListServicesCommand({ cluster: clusterArn }),
      );
      const serviceArns = servicesResponse.serviceArns || [];
      console.log('Services:', serviceArns);

      if (serviceArns.length > 0) {
        const describeServices = await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterArn,
            services: serviceArns,
          }),
        );

        for (const service of describeServices.services || []) {
          console.log(`Service Name: ${service.serviceName}`);
          console.log(`Task Definition: ${service.taskDefinition}`);

          const taskDefResponse = await ecsClient.send(
            new DescribeTaskDefinitionCommand({
              taskDefinition: service.taskDefinition,
            }),
          );
          const containerDefinitions =
            taskDefResponse.taskDefinition.containerDefinitions || [];
          for (const cd of containerDefinitions) {
            console.log(`  Container Name: ${cd.name}`);
            console.log(
              `  Log Configuration:`,
              JSON.stringify(cd.logConfiguration, null, 2),
            );
          }
        }
      }

      const tasksResponse = await ecsClient.send(
        new ListTasksCommand({ cluster: clusterArn }),
      );
      console.log('Running Tasks:', tasksResponse.taskArns || []);
    }
  } catch (error) {
    console.error('Error inspecting ECS:', error);
  }
}

main();
