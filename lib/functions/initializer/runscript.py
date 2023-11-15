import boto3
#import cfnresponse
import mysql.connector
import os
import json


SECRET_NAME = os.environ['DB_CONFIG_SECRET']


secrets_client = boto3.client('secretsmanager')
db_credentials = json.loads(secrets_client.get_secret_value(SecretId=SECRET_NAME).get('SecretString'))

db_endpoint_port = db_credentials["port"]
db_endpoint_address = db_credentials["host"]
db_password = db_credentials["password"]
db_user = db_credentials["username"]
db_database = db_credentials["dbname"]

response_data = {}

def lambda_handler(event, context):

    print(json.dumps(event))

    try:
        with open('script.sql', encoding="utf-8") as file:
            sql_statements = [line.rstrip() for line in file]        
        
        conn = mysql.connector.connect(
            host=db_endpoint_address,
            port=db_endpoint_port,
            user=db_user,
            password=db_password
            )
        cur = conn.cursor()
        
        for sql in sql_statements:
            if sql:
                print(sql)
                cur.execute(sql)
                resp = cur.fetchall()
                print(sql, resp)
            
        cur.close()
        conn.commit()
               
    except Exception as e:
        print(e)       

