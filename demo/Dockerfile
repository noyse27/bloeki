# Tiny one-shot image used only by docker-compose.demo.yml's "demo-clips"
# service: renders the synthetic placeholder trailer clips (see
# generate-clips.sh's own header comment for why they're generated here
# instead of shipped as files) and exits. Never part of the normal
# (non-demo) deployment.
FROM alpine:3.20
RUN apk add --no-cache ffmpeg ttf-dejavu
COPY generate-clips.sh /generate-clips.sh
RUN chmod +x /generate-clips.sh
ENTRYPOINT ["/generate-clips.sh"]
