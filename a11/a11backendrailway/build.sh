#!/bin/bash
set -e

echo "Installing deps..."
apt-get update
apt-get install -y wget unzip

echo "Downloading Piper..."
wget https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz

echo "Extracting..."
tar -xvf piper_linux_x86_64.tar.gz

echo "Fix permissions..."
chmod +x piper

echo "Moving binary..."
mv piper /usr/local/bin/piper

echo "Test Piper in PATH..."
which piper
piper --help

echo "Done."
