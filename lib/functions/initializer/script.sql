-- Your SQL scripts for initialization goes here...

CREATE USER IF NOT EXISTS django IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT ALL PRIVILEGES ON `main`.* TO 'django'@'%';
FLUSH PRIVILEGES;