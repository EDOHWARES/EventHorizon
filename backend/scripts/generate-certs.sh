#!/bin/sh
# Generate CA, server, and client certs for mTLS demo
set -e
CERTS_DIR="/app/certs"
mkdir -p $CERTS_DIR
cd $CERTS_DIR
openssl req -x509 -newkey rsa:4096 -days 365 -nodes -keyout ca.key -out ca.crt -subj "/CN=EventHorizonCA"
openssl req -newkey rsa:4096 -nodes -keyout server.key -out server.csr -subj "/CN=backend"
opennssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365
openssl req -newkey rsa:4096 -nodes -keyout client.key -out client.csr -subj "/CN=envoy"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365
