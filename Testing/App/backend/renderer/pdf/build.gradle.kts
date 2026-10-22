plugins { java; application }

repositories { mavenCentral() }
java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }
dependencies {
    implementation("org.apache.pdfbox:pdfbox:3.0.8")
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
application { mainClass = "org.botai.pdf.RenderServer" }
tasks.test {
    useJUnitPlatform()
    systemProperty("java.awt.headless", "true")
    systemProperty("sun.net.httpserver.drainAmount", "0")
    systemProperty("jdk.httpserver.maxConnections", "32")
    systemProperty("pdf.test.classpath", sourceSets.test.get().runtimeClasspath.asPath)
}
