#!/bin/bash
BASEDIR=$(realpath $(dirname $0))
CONTEXT_TARGET=$(dirname $BASEDIR)
CONTEXT_TARGET=$(dirname $CONTEXT_TARGET)

cd $CONTEXT_TARGET

: "${XO_IMAGE_NAME:=xopat-dev:v0.0.1}"

echo
echo "Starting build: docker build -t \"$XO_IMAGE_NAME\" -f $BASEDIR/Dockerfile ."
echo
docker build --target viewer-dev -t "$XO_IMAGE_NAME" -f $BASEDIR/Dockerfile .
cd -
