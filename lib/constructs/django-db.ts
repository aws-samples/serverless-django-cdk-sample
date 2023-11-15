import { aws_ec2, aws_rds, aws_kms, aws_logs, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DBInitializer } from "./db-initializer";
import { Credentials } from "aws-cdk-lib/aws-rds";
import { NagSuppressions } from "cdk-nag";


export interface DjangoDBProps {
    readonly vpc: aws_ec2.Vpc;
}

export class DjangoDB extends Construct {
    constructor(scope: Construct, id: string, props: DjangoDBProps) {
        super(scope, id);

        const dbKey = new aws_kms.Key(this, 'django-db-key',
            {
                alias: 'django-db-key',
                enableKeyRotation: true
            })

        const dbSecurityGroup = new aws_ec2.SecurityGroup(this, 'database-sg', {
            vpc: props.vpc,
            allowAllOutbound: true
        })

        const dbCredentials = new aws_rds.DatabaseSecret(this, 'database-credentials', {
            username: 'admin',

        })
        NagSuppressions.addResourceSuppressions(dbCredentials, [
            {
                id: 'AwsSolutions-SMG4',
                reason: 'Rotation disabled to avoid complexity for sample purposes.'
            },
        ])

        const dbServerless = new aws_rds.DatabaseCluster(this, 'Database', {
            engine: aws_rds.DatabaseClusterEngine.auroraMysql({ version: aws_rds.AuroraMysqlEngineVersion.VER_3_03_1 }),
            writer: aws_rds.ClusterInstance.serverlessV2('writer', {
                allowMajorVersionUpgrade: true,
                enablePerformanceInsights: true,
                performanceInsightEncryptionKey: dbKey,
            }),
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 2,
            readers: [
                aws_rds.ClusterInstance.serverlessV2('reader1', {
                    scaleWithWriter: true,
                    allowMajorVersionUpgrade: true,
                    enablePerformanceInsights: true,
                    performanceInsightEncryptionKey: dbKey
                }),
            ],
            vpc: props.vpc,
            iamAuthentication: true,
            storageEncryptionKey: dbKey,
            defaultDatabaseName: 'main',
            credentials: Credentials.fromSecret(dbCredentials),
            securityGroups: [dbSecurityGroup],
            cloudwatchLogsExports: [
                'general',
                'error',
                'audit',
            ],
            cloudwatchLogsRetention: aws_logs.RetentionDays.ONE_MONTH
        });
        NagSuppressions.addResourceSuppressions(dbServerless, [
            {
                id: 'AwsSolutions-RDS10',
                reason: 'Deletion protection disables for easier cleanup of the sample.'
            },
            {
                id: 'AwsSolutions-RDS11',
                reason: 'Default port as for sample purposes'
            },
            {
                id: 'AwsSolutions-RDS14',
                reason: 'No Backtrack as for sample purposes'
            },
        ])

        const initializer = new DBInitializer(this, 'DjangoDBInit', {
            dbConfigSecret: dbServerless.secret?.secretName!,
            vpc: props.vpc
        })

        dbSecurityGroup.addIngressRule(initializer.fnSecurityGroup, aws_ec2.Port.tcp(3306))
        dbCredentials.grantRead(initializer.function)
        initializer.function.executeAfter(dbServerless)

        this.dbSecurityGroup = dbSecurityGroup
        this.dbCluster = dbServerless
    }

    dbSecurityGroup: aws_ec2.SecurityGroup
    dbCluster: aws_rds.DatabaseCluster
}