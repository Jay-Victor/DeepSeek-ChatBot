import com.android.build.gradle.internal.api.BaseVariantOutputImpl
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

fun signingValue(key: String): String? = localProperties.getProperty(key)?.takeIf { it.isNotBlank() }

val keystoreReady = listOf("KEYSTORE_FILE", "KEYSTORE_PASSWORD", "KEYSTORE_ALIAS", "KEY_PASSWORD")
    .all { signingValue(it) != null }

android {
    namespace = "com.deepseekchatbot"
    compileSdk = 36
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.deepseekchatbot"
        minSdk = 26
        targetSdk = 36
        versionCode = 11
        versionName = "0.1.10"
    }

    if (keystoreReady) {
        signingConfigs {
            create("release") {
                storeFile = file(signingValue("KEYSTORE_FILE")!!)
                storePassword = signingValue("KEYSTORE_PASSWORD")
                keyAlias = signingValue("KEYSTORE_ALIAS")
                keyPassword = signingValue("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = if (keystoreReady) signingConfigs.getByName("release") else null
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    applicationVariants.all {
        outputs.forEach { output ->
            output as BaseVariantOutputImpl
            output.outputFileName = "DeepSeekChatBot-v${versionName}-${name}.apk"
        }
    }

    lint {
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
}
