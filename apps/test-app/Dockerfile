FROM --platform=linux/amd64 python:3.11
ENV PYTHONUNBUFFERED 1
ENV PYTHONDONTWRITEBYTECODE 1
ENV LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN 1

RUN \
    apt-get -y update && \
    apt-get -y install nano

RUN mkdir /code
WORKDIR /code
COPY --chown=app:app requirements.txt mysite/ /code/

RUN python3 -m pip install --upgrade pip
RUN pip install -r requirements.txt 

RUN useradd -m app
USER app

ADD --chown=app:app . /code/
WORKDIR /code/mysite
