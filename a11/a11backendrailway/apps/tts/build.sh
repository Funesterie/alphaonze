#!/bin/bash
set -e

echo "Installing dependencies..."
apt-get update
apt-get install -y wget unzip

echo "Downloading Piper..."
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz

echo "Extracting Piper..."
tar -xvf piper_linux_x86_64.tar.gz

echo "Done."

# Move and chmod piper binary for Railway
mv piper apps/tts/piper
chmod +x apps/tts/piper
