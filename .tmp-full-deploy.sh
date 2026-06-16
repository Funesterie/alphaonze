#!/bin/sh
set -e
COMPOSE_DIR=/home/deploy/a11-prod/current/server

# 1. Recreate backend containers from compose (applies new env vars from secrets + compose overrides)
cd "$COMPOSE_DIR"
docker-compose -f docker-compose.prod.yml up -d --no-build --no-deps a11-backend-blue a11-backend a11-backend-green
echo "Containers recreated"

# 2. Re-apply code patches (lost when containers recreated from image)
docker cp /tmp/image-pipeline-direct.cjs a11-backend-blue:/app/src/image/image-pipeline-direct.cjs
docker cp /tmp/image-pipeline-direct.cjs a11-backend:/app/src/image/image-pipeline-direct.cjs
docker cp /tmp/image-pipeline-direct.cjs a11-backend-green:/app/src/image/image-pipeline-direct.cjs

docker cp /tmp/sd-tools.cjs a11-backend-blue:/app/src/routes/sd-tools.cjs
docker cp /tmp/sd-tools.cjs a11-backend:/app/src/routes/sd-tools.cjs
docker cp /tmp/sd-tools.cjs a11-backend-green:/app/src/routes/sd-tools.cjs
echo "Code patches re-applied"

# 3. Restart to load the patched code
docker restart a11-backend-blue a11-backend a11-backend-green
echo "Done. Check: docker exec a11-backend-blue env | grep A11_IMAGE_DIRECT_GROQ"
