/**
 * Fabric 26.3 目标适配器。
 *
 * 26.3 的关键事实（都已在真实工程里验证过，不要凭记忆改）：
 *  - 26.1 起 Minecraft 不再混淆，直接用官方类名，没有 mappings 声明
 *  - loom 插件 id 是 net.fabricmc.fabric-loom（没有 -remap 后缀），依赖走 implementation
 *  - 物品/工具/盔甲是组件式的，没有 SwordItem / ArmorItem 类，行为由 Item.Properties 工厂方法表达
 *  - 创造栏事件是 CreativeModeTabEvents（原 ItemGroupEvents 已改名）
 *  - 配置特征目录是 worldgen/feature/，不是 worldgen/configured_feature/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPascal } from '../../ids.mjs';
import * as java from './java.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER_DIR = path.join(HERE, 'wrapper');

export default {
  id: 'fabric-26.3',
  label: 'Fabric 26.3',
  platform: 'fabric',
  mcVersion: '26.3',
  javaVersion: 25,

  defaults: {
    platform: 'fabric',
    mcVersion: '26.3',
    loaderVersion: '0.19.5',
    apiVersion: '0.164.0+26.3',
    javaVersion: 25,
    loomVersion: '1.17.21',
    gradleVersion: '9.5.1',
  },

  /** 能力开关：模块据此决定生成策略，不用各自判断版本号 */
  features: {
    componentItems: true,
    itemModelDef: true,
    equipmentAssets: true,
    creativeTabEvent: 'CreativeModeTabEvents',
    worldgenFeatureDir: 'feature',
    lootConditionStyle: 'compact', // 26.x 的 condition/modifier 紧凑写法
  },

  paths: {
    javaDir: (pkg) => `src/main/java/${pkg.replace(/\./g, '/')}`,
    assets: (ns) => `src/main/resources/assets/${ns}`,
    data: (ns) => `src/main/resources/data/${ns}`,
  },

  /**
   * 工程骨架：构建脚本 + 平台元数据 + wrapper。
   * 这些文件只在「新建工程」或「目标版本变更」时写，日常生成不碰。
   */
  scaffold(p, opts = {}) {
    const id = p.meta.id;
    const cls = toPascal(id);
    const pkg = p.meta.pkg;
    const t = p.target;
    const files = [];

    files.push({
      path: 'settings.gradle',
      content: `pluginManagement {
    repositories {
        maven { url 'https://maven.fabricmc.net/' }
        mavenCentral()
        gradlePluginPortal()
    }
}

// foojay：缺 JDK 时由 Gradle 自动下载（26.x 目标 Java 25，本机 JDK 常更旧）
plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '1.0.0'
}

rootProject.name = "${id}"
`,
    });

    files.push({
      path: 'build.gradle',
      content: `plugins {
    // 26.x 线用原生 loom（无 remap 后缀），依赖一律走 implementation
    id 'net.fabricmc.fabric-loom' version "${t.loomVersion || '1.17.21'}"
}

group = "${pkg}"
version = "${p.meta.version}"

dependencies {
    minecraft "com.mojang:minecraft:\${minecraft_version}"
    // 26.1 起 Minecraft 不再混淆，Mojang 官方类名直接可用，因此没有 mappings 行
    implementation "net.fabricmc:fabric-loader:\${loader_version}"
    implementation "net.fabricmc.fabric-api:fabric-api:\${fabric_api_version}"
}

processResources {
    filesMatching('fabric.mod.json') {
        expand "version": version
    }
}

// 目标 Java 版本用 toolchain 声明。环境 JDK 低于目标时，只有 toolchain 才会
// 让 foojay 自动 provision 对应 JDK；用 sourceCompatibility 会直接报「不支持发行版本」。
java {
    withSourcesJar()
    toolchain {
        languageVersion = JavaLanguageVersion.of(${t.javaVersion})
    }
}
${opts.clientModsDir ? `
// 一键把产物拷进客户端 mods 目录
tasks.register('deployToClient', Copy) {
    group = 'build'
    description = '把 jar 复制到客户端 mods 目录'
    dependsOn tasks.named('jar')
    from(tasks.named('jar').flatMap { it.archiveFile })
    into file(client_mods_dir)
    doLast {
        logger.lifecycle("[${id}] 已部署到 \${file(client_mods_dir)}")
    }
}
` : ''}`,
    });

    files.push({
      path: 'gradle.properties',
      content: `# 26.3 线：Gradle ${t.gradleVersion || '9.5.1'} + loom ${t.loomVersion || '1.17.21'}
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true
org.gradle.configuration-cache=false

minecraft_version=${t.mcVersion}
loader_version=${t.loaderVersion}
loom_version=${t.loomVersion || '1.17.21'}
fabric_api_version=${t.apiVersion}

version=${p.meta.version}
group=${pkg}
${opts.clientModsDir ? `\nclient_mods_dir=${opts.clientModsDir}\n` : ''}`,
    });

    files.push({
      path: 'src/main/resources/fabric.mod.json',
      content: JSON.stringify(
        {
          schemaVersion: 1,
          id,
          version: '${version}',
          name: p.meta.name,
          description: p.meta.description || `${p.meta.name} —— 由 MC Studio 生成`,
          authors: p.meta.authors ? p.meta.authors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [],
          license: p.meta.license || 'MIT',
          icon: `assets/${id}/icon.png`,
          environment: '*',
          entrypoints: { main: [`${pkg}.${cls}`] },
          mixins: [`${id}.mixins.json`],
          depends: {
            fabricloader: `>=${t.loaderVersion}`,
            minecraft: `~${t.mcVersion}`,
            java: `>=${t.javaVersion}`,
            'fabric-api': '*',
          },
        },
        null,
        2,
      ),
    });

    // wrapper：二进制原样搬运，读不到就跳过（用户可能已有 wrapper）
    for (const rel of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
      const src = path.join(WRAPPER_DIR, rel);
      if (fs.existsSync(src)) {
        files.push({ path: rel, content: fs.readFileSync(src), binary: true, mode: rel === 'gradlew' ? 0o755 : undefined });
      }
    }

    return files;
  },

  /** 平台元数据里那些「每次生成都要刷新」的文件 */
  metadata(p) {
    return [
      {
        path: `src/main/resources/${p.meta.id}.mixins.json`,
        content: JSON.stringify(
          {
            required: true,
            minVersion: '0.8',
            package: `${p.meta.pkg}.mixin`,
            compatibilityLevel: `JAVA_${p.target.javaVersion}`,
            mixins: [],
            client: [],
            injectors: { defaultRequire: 1 },
          },
          null,
          2,
        ),
      },
    ];
  },

  /** Java 源码 */
  javaFiles(p) {
    const dir = `src/main/java/${p.meta.pkg.replace(/\./g, '/')}`;
    const out = [];
    const add = (rel, content) => {
      if (content) out.push({ path: `${dir}/${rel}`, content });
    };
    add(`${toPascal(p.meta.id)}.java`, java.genMainClass(p));
    add('registry/ModTags.java', java.genTags(p));
    add('registry/ModTiers.java', java.genTiers(p));
    add('registry/ModArmorMaterials.java', java.genArmorMaterials(p));
    add('registry/ModItems.java', java.genItems(p));
    add('registry/ModBlocks.java', java.genBlocks(p));
    add('registry/ModTabs.java', java.genTabs(p));
    add('world/ModWorldGen.java', java.genWorldGen(p));
    add('item/DescribedItem.java', java.genDescribedItem(p));
    return out;
  },

  /** 手写区文件：只在缺失时创建 */
  handWritten(p) {
    const dir = `src/main/java/${p.meta.pkg.replace(/\./g, '/')}`;
    return [{ path: `${dir}/custom/CustomContent.java`, content: java.genCustomContent(p), createOnly: true }];
  },
};
