# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk@sha256:3e3c176ffed168beb42c607be9bc1639b466cf00261a0fb04425562c9d0c5c2b AS build
WORKDIR /workspace
COPY gradlew ./
COPY gradle ./gradle
COPY renderer/pdf ./renderer/pdf
RUN --mount=type=cache,target=/root/.gradle chmod +x gradlew && ./gradlew -p renderer/pdf installDist --no-daemon --max-workers=2 -Dorg.gradle.jvmargs="-Xmx256m"
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
WORKDIR /app
RUN useradd --system --uid 10002 renderer
COPY --from=build /workspace/renderer/pdf/build/install/botai-pdf-renderer/lib ./lib
USER 10002
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["java","-Xmx64m","-XX:MaxMetaspaceSize=64m","-Djava.awt.headless=true","-Dsun.net.httpserver.maxReqTime=45","-Dsun.net.httpserver.maxRspTime=55","-Dsun.net.httpserver.timerMillis=1000","-Djdk.httpserver.maxConnections=32","-Dsun.net.httpserver.maxIdleConnections=16","-Dsun.net.httpserver.drainAmount=0","-cp","/app/lib/*","org.botai.pdf.RenderServer"]
