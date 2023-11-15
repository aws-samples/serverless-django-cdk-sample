import { aws_ssm, aws_ec2, aws_kms, aws_ecr_assets, aws_ecs, aws_iam, Stack, Size, aws_s3, RemovalPolicy, aws_certificatemanager, aws_route53, aws_elasticloadbalancingv2, aws_cloudfront, aws_cloudfront_origins, aws_route53_targets, aws_rds } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../get-config";
import { NagSuppressions } from "cdk-nag";
import { AwsCustomResource, AwsCustomResourcePolicy } from "aws-cdk-lib/custom-resources";

export interface DjangoECSProps {
    readonly vpc: aws_ec2.Vpc;
    readonly dbSecurityGroup: aws_ec2.SecurityGroup;
    readonly dbCluster: aws_rds.DatabaseCluster
}

export class DjangoECS extends Construct {
    constructor(scope: Construct, id: string, props: DjangoECSProps, buildConfig: BuildConfig) {
        super(scope, id);

        const djangoDomain = 'django.' + buildConfig.Parameters.PERSONAL_HOSTED_ZONE_DOMAIN

        const ecsKey = new aws_kms.Key(this, 'ecs-key', {
            alias: 'ecs-key',
            enableKeyRotation: true
        })

        const ecsSecurityGroup = new aws_ec2.SecurityGroup(this, 'ecs-security-group', {
            vpc: props.vpc
        })
        props.dbSecurityGroup.addIngressRule(ecsSecurityGroup, aws_ec2.Port.tcp(3306))

        const ecsStaticBucket = new aws_s3.Bucket(this, 'ecs-static-bucket', {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: aws_s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true
        })
        NagSuppressions.addResourceSuppressions(ecsStaticBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Bucket only for static website content delivery'
            },
        ])

        const djangoImage = new aws_ecr_assets.DockerImageAsset(this, 'django-image', {
            directory: './apps/test-app'
        })

        const ecsCluster = new aws_ecs.Cluster(this, 'ecs-cluster', {
            vpc: props.vpc,
            executeCommandConfiguration: {
                kmsKey: ecsKey
            },
            containerInsights: true
        })
        ecsCluster.node.addDependency(props.dbCluster)
        const djangoEnv = {
            DB_HOST: props.dbCluster.clusterEndpoint.hostname,
            DB_PORT: props.dbCluster.clusterEndpoint.port.toString(),
            DB_USER: "django",
            DB_NAME: "main",
            STATIC_BUCKET_NAME: ecsStaticBucket.bucketName,
            DEBUG_FLAG: "False",
            HOST_NAMES: [djangoDomain].join(","),
            AWS_REGION: Stack.of(this).region
        };
        const ssmParameter = new aws_ssm.StringParameter(this, "ecsTaskParams", {
            parameterName: "ecsTaskParams",
            stringValue: JSON.stringify(djangoEnv),
        });
        const taskParams = {
            taskParams: "ecsTaskParams",
        };
        const djangoTaskRole = new aws_iam.Role(this, 'django-task-role', {
            assumedBy: new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com')
        });
        djangoTaskRole.addManagedPolicy(new aws_iam.ManagedPolicy(this, 'db-access-policy', {
            statements: [
                new aws_iam.PolicyStatement({
                    effect: aws_iam.Effect.ALLOW,
                    actions: ["rds-db:connect"],
                    resources: [
                        `arn:aws:rds-db:${Stack.of(this).region}:${Stack.of(this).account}:dbuser:${props.dbCluster.clusterResourceIdentifier}/django`
                    ]
                })
            ]
        }))        
        ecsStaticBucket.grantReadWrite(djangoTaskRole)
        ssmParameter.grantRead(djangoTaskRole)

        const djangoTaskExecutionRole = new aws_iam.Role(this, 'django-execution-role', {
            assumedBy: new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ]
        });
        NagSuppressions.addResourceSuppressions(djangoTaskExecutionRole, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Simplicity for sample purposes'
            }
        ])

        const taskDefinition = new aws_ecs.FargateTaskDefinition(this, 'django-fargate-taskdef', {
            cpu: 512,
            memoryLimitMiB: 1024,
            executionRole: djangoTaskExecutionRole,
            taskRole: djangoTaskRole
        });
        NagSuppressions.addResourceSuppressions(taskDefinition, [
            {
                id: 'AwsSolutions-ECS2',
                reason: 'No secrets handled with Env variables'
            }
        ])
        // Standard Django Container
        taskDefinition.addContainer('django-container', {
            image: aws_ecs.ContainerImage.fromDockerImageAsset(djangoImage),
            environment: taskParams,
            command: ["gunicorn", "-w", "3", "-b", ":8000", "mysite.wsgi:application"],
            portMappings: [
                {
                    containerPort: 8000
                }
            ],
            logging: aws_ecs.LogDrivers.awsLogs({
                streamPrefix: 'Django',
                mode: aws_ecs.AwsLogDriverMode.NON_BLOCKING,
                maxBufferSize: Size.mebibytes(25),
            }),
            healthCheck: {
                command: ["CMD-SHELL", "curl -f http://127.0.0.1:8000/ping/ || exit 1"],
                retries: 3
            }
        });

        // Container to execute one-time migrations
        taskDefinition.addContainer('django-migrate-container', {
            image: aws_ecs.ContainerImage.fromDockerImageAsset(djangoImage),
            environment: taskParams,
            command: ["python", "manage.py", "migrate"],
            essential: false,
            logging: aws_ecs.LogDrivers.awsLogs({
                streamPrefix: 'DjangoMigrate',
                mode: aws_ecs.AwsLogDriverMode.NON_BLOCKING,
                maxBufferSize: Size.mebibytes(25),
            })
        });

        // Container to execute one-time static files collection to S3
        taskDefinition.addContainer('django-collectstatic-container', {
            image: aws_ecs.ContainerImage.fromDockerImageAsset(djangoImage),
            environment: taskParams,
            command: ["python", "manage.py", "collectstatic", "--noinput"],
            essential: false,
            logging: aws_ecs.LogDrivers.awsLogs({
                streamPrefix: 'DjangoCollectStatic',
                mode: aws_ecs.AwsLogDriverMode.NON_BLOCKING,
                maxBufferSize: Size.mebibytes(25),
            })
        });

        const djangoFargateService = new aws_ecs.FargateService(this, 'django-fargate-service', {
            cluster: ecsCluster,
            taskDefinition: taskDefinition,
            enableExecuteCommand: true,
            desiredCount: 1,
            securityGroups: [ecsSecurityGroup],
            vpcSubnets: {
                subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            circuitBreaker: {
                rollback: true,
            }
        });

        // ELB
        const serverCertificate = new aws_certificatemanager.Certificate(this, 'server-certificate', {
            domainName: djangoDomain,
            validation: aws_certificatemanager.CertificateValidation.fromDns(aws_route53.HostedZone.fromHostedZoneAttributes(this, 'server-zone', {
                hostedZoneId: buildConfig.Parameters.PERSONAL_HOSTED_ZONE_ID,
                zoneName: buildConfig.Parameters.PERSONAL_HOSTED_ZONE_DOMAIN
            }))
        })

        const lbSg = new aws_ec2.SecurityGroup(this, 'lb-open-sg', {
            vpc: props.vpc,
            allowAllOutbound: true            
        })
        // Get Cloudfront Prefix Lists from Custom Resource
        const prefixLists = new AwsCustomResource(this, 'prefixLists', {
            onUpdate: {
                service: 'EC2',
                action: 'describeManagedPrefixLists',
                parameters: {
                    Filters: [
                        {
                            Name: 'prefix-list-name',
                            Values: [`com.amazonaws.global.cloudfront.origin-facing`],
                        },
                    ],
                },
                physicalResourceId: {},
            },
            policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
            logRetention: 1,
        });
        lbSg.addIngressRule(aws_ec2.Peer.prefixList(prefixLists.getResponseField('PrefixLists.0.PrefixListId')), aws_ec2.Port.tcp(443))

        const lbSgImmutable = aws_ec2.SecurityGroup.fromSecurityGroupId(
            this, 
            'lbSgImmutable', 
            lbSg.securityGroupId,
            {
                mutable: false
            }        
        )

        const lb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'lb-open', {
            vpc: props.vpc,
            internetFacing: true,
            securityGroup: lbSgImmutable
        });
        NagSuppressions.addResourceSuppressions(lb, [
            {
                id: 'AwsSolutions-ELB2',
                reason: 'No Access Logs for sample purposes'
            }
        ])

        ecsSecurityGroup.addIngressRule(lbSg, aws_ec2.Port.allTcp())

        const listener = lb.addListener('listener', {
            port: 443,
            certificates: [serverCertificate]
        })

        listener.addTargets('ECS', {
            targets: [djangoFargateService.loadBalancerTarget({
                containerName: 'django-container'
            })],
            port: 8000,
            healthCheck: {
                path: '/ping/'
            }
        })

        // Origins

        const elb_origin = new aws_cloudfront_origins.LoadBalancerV2Origin(lb, {
            protocolPolicy: aws_cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        });

        const origin_access_identity = new aws_cloudfront.OriginAccessIdentity(this, "OriginAccessIdentity", {
            comment: "Read Access from Cloudfront to WebsiteBucket"
        });

        const s3_origin = new aws_cloudfront_origins.S3Origin(ecsStaticBucket, {
            originAccessIdentity: origin_access_identity
        })

        ecsStaticBucket.grantRead(origin_access_identity);

        // CLoudfront
        const cf_distribution = new aws_cloudfront.Distribution(this, "CFDistribution", {
            defaultBehavior: {
                origin: elb_origin,
                cachePolicy: aws_cloudfront.CachePolicy.CACHING_DISABLED,
                allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_ALL,
                viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                originRequestPolicy: aws_cloudfront.OriginRequestPolicy.ALL_VIEWER,
            },
            additionalBehaviors: {
                '/static/*': {
                    origin: s3_origin,
                    cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                }
            },
            certificate: serverCertificate,
            domainNames: [djangoDomain]
        })
        NagSuppressions.addResourceSuppressions(cf_distribution, [
            {
                id: 'AwsSolutions-CFR1',
                reason: 'No geo restriction for sample purposes'
            },
            {
                id: 'AwsSolutions-CFR2',
                reason: 'No WAF for sample purposes'
            },
            {
                id: 'AwsSolutions-CFR3',
                reason: 'No Access Logs for sample purposes'
            }
        ])

        const hostedZone = aws_route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: buildConfig.Parameters.PERSONAL_HOSTED_ZONE_ID,
            zoneName: buildConfig.Parameters.PERSONAL_HOSTED_ZONE_DOMAIN
        });

        new aws_route53.ARecord(this, 'CFRecordSet', {
            zone: hostedZone,
            recordName: djangoDomain,
            target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.CloudFrontTarget(cf_distribution))
        });


    }

}
