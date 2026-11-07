/**
 * Forge 1.20.1 目标适配器。
 *
 * 骨架直接照 Forge 官方 MDK（1.20.1-47.4.0）来，不用凭记忆拼：
 *  - ForgeGradle [6.0,6.2) / Gradle 8.8 / Java 17 / official 1.20.1 映射
 *  - 注册走 DeferredRegister + RegistryObject，挂到 mod event bus
 *  - 元数据是 META-INF/mods.toml（Forge 没有 fabric.mod.json / mixins.json）
 *  - 资源是 1.20.1 的旧格式（models/item、tags/blocks 复数、configured_feature）
 *
 * 这些是 1.20.1 与 26.3 最大的差异，绝不能混用。features 里的开关
 * 让通用资源生成器选对「方言」，见 core/generator/resources.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPascal, toConstant } from '../../ids.mjs';
import * as java from './java.mjs';
import * as visual from './visual.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER_DIR = path.join(HERE, 'wrapper');

const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/[\\"']/g, ' ').trim();

export default {
  id: 'forge-1.20.1',
  label: 'Forge 1.20.1',
  platform: 'forge',
  mcVersion: '1.20.1',
  javaVersion: 17,

  defaults: {
    platform: 'forge',
    mcVersion: '1.20.1',
    forgeVersion: '47.4.0',
    minecraftVersionRange: '[1.20.1,1.21)',
    forgeVersionRange: '[47,)',
    loaderVersionRange: '[47,)',
    mappingChannel: 'official',
    mappingVersion: '1.20.1',
    forgeGradleVersion: '[6.0,6.2)',
    gradleVersion: '8.8',
    javaVersion: 17,
  },

  features: {
    // 1.20.1 是「类继承式」：SwordItem / ArmorItem 这些类都还在，
    // 没有 26.x 的 Item.Properties().sword() 组件写法。
    componentItems: false,
    itemModelDef: false,
    equipmentAssets: false,
    creativeTabEvent: 'BuildCreativeModeTabContentsEvent',
    worldgenFeatureDir: 'configured_feature',
    lootModifierKey: 'functions',
    tagDirs: { block: 'tags/blocks', item: 'tags/items' },
    resourceFormat: '1.20.1',
    oreStateObject: true, // target.state 是 {"Name": ...} 而不是字符串
    biomeModifier: true, // 世界生成靠 data/<ns>/forge/biome_modifier/*.json 挂载
  },

  paths: {
    javaDir: (pkg) => `src/main/java/${pkg.replace(/\./g, '/')}`,
    assets: (ns) => `src/main/resources/assets/${ns}`,
    data: (ns) => `src/main/resources/data/${ns}`,
  },

  scaffold(p, opts = {}) {
    const id = p.meta.id;
    const cls = toPascal(id);
    const pkg = p.meta.pkg;
    const t = p.target;
    const files = [];
    const authors = clean(p.meta.authors) || 'MC Studio';
    const desc = clean(p.meta.description) || `${p.meta.name} —— 由 MC Studio 生成`;
    const license = clean(p.meta.license) || 'MIT';

    // 本地 mod 依赖（积木库要求某个 mod 时用）
    // ⚠️ 用 compileOnly：这些 jar 只是编译期需要，运行期由玩家自己装。
    //    路径里的反斜杠要转成斜杠（Gradle 在 Windows 上也吃斜杠）。
    const localDeps = (p.localDeps || [])
      .filter((d) => d && d.path)
      .map((d) => `    compileOnly files('${String(d.path).replace(/\\/g, '/')}')`)
      .join('\n');

    files.push({
      path: 'settings.gradle',
      content: `pluginManagement {
    repositories {
        gradlePluginPortal()
        maven { name = 'MinecraftForge'; url = 'https://maven.minecraftforge.net/' }
    }
}

plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.7.0'
}

rootProject.name = "${id}"
`,
    });

    files.push({
      path: 'build.gradle',
      content: `plugins {
    id 'eclipse'
    id 'idea'
    id 'maven-publish'
    id 'net.minecraftforge.gradle' version '${t.forgeGradleVersion || '[6.0,6.2)'}'
}

version = mod_version
group = mod_group_id

base {
    archivesName = mod_id
}

// 1.18+ 官方给玩家发的是 Java 17，模组必须编到 17
java.toolchain.languageVersion = JavaLanguageVersion.of(${t.javaVersion})

minecraft {
    mappings channel: mapping_channel, version: mapping_version
    copyIdeResources = true
    runs {
        configureEach {
            workingDirectory project.file('run')
            property 'forge.logging.markers', 'REGISTRIES'
            property 'forge.logging.console.level', 'debug'
            mods { "\${mod_id}" { source sourceSets.main } }
        }
        client { property 'forge.enabledGameTestNamespaces', mod_id }
        server { property 'forge.enabledGameTestNamespaces', mod_id; args '--nogui' }
    }
}

sourceSets.main.resources { srcDir 'src/generated/resources' }

dependencies {
    minecraft "net.minecraftforge:forge:\${minecraft_version}-\${forge_version}"
${localDeps}
}

tasks.named('processResources', ProcessResources).configure {
    var replaceProperties = [
            minecraft_version: minecraft_version, minecraft_version_range: minecraft_version_range,
            forge_version: forge_version, forge_version_range: forge_version_range,
            loader_version_range: loader_version_range,
            mod_id: mod_id, mod_name: mod_name, mod_license: mod_license, mod_version: mod_version,
            mod_authors: mod_authors, mod_description: mod_description,
    ]
    inputs.properties replaceProperties
    filesMatching(['META-INF/mods.toml', 'pack.mcmeta']) { expand replaceProperties + [project: project] }
}

tasks.named('jar', Jar).configure {
    manifest {
        attributes([
                'Specification-Title': mod_id,
                'Specification-Vendor': mod_authors,
                'Implementation-Title': project.name,
                'Implementation-Vendor': mod_authors,
        ])
    }
    finalizedBy 'reobfJar'
}

tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }
${opts.clientModsDir ? `
tasks.register('deployToClient', Copy) {
    group = 'build'
    description = '把 jar 复制到客户端 mods 目录'
    dependsOn tasks.named('jar')
    from(tasks.named('jar').flatMap { it.archiveFile })
    into file(client_mods_dir)
    doLast { logger.lifecycle("[${id}] 已部署到 \${file(client_mods_dir)}") }
}
` : ''}`,
    });

    files.push({
      path: 'gradle.properties',
      content: `# Forge 1.20.1 / ForgeGradle 6 —— 官方 MDK 同款配置
org.gradle.jvmargs=-Xmx3G
org.gradle.daemon=false

minecraft_version=${t.mcVersion}
minecraft_version_range=${t.minecraftVersionRange}
forge_version=${t.forgeVersion}
forge_version_range=${t.forgeVersionRange}
loader_version_range=${t.loaderVersionRange}
mapping_channel=${t.mappingChannel}
mapping_version=${t.mappingVersion}

mod_id=${id}
mod_name=${clean(p.meta.name)}
mod_license=${license}
mod_version=${p.meta.version}
mod_group_id=${pkg}
mod_authors=${authors}
mod_description=${desc}
${opts.clientModsDir ? `\nclient_mods_dir=${opts.clientModsDir}\n` : ''}`,
    });

    files.push({
      path: 'src/main/resources/META-INF/mods.toml',
      content: `modLoader="javafml"
loaderVersion="\${loader_version_range}"
license="\${mod_license}"

[[mods]]
modId="\${mod_id}"
version="\${mod_version}"
displayName="\${mod_name}"
authors="\${mod_authors}"
description='''\${mod_description}'''

[[dependencies.\${mod_id}]]
    modId="forge"
    mandatory=true
    versionRange="\${forge_version_range}"
    ordering="NONE"
    side="BOTH"

[[dependencies.\${mod_id}]]
    modId="minecraft"
    mandatory=true
    versionRange="\${minecraft_version_range}"
    ordering="NONE"
    side="BOTH"
`,
    });

    files.push({
      path: 'src/main/resources/pack.mcmeta',
      content: JSON.stringify({ pack: { description: { text: `${id} resources` }, pack_format: 15 } }, null, 2) + '\n',
    });

    // wrapper 用官方 MDK 自带的（Gradle 8.8），二进制原样搬运
    for (const rel of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
      const src = path.join(WRAPPER_DIR, rel);
      if (fs.existsSync(src)) {
        files.push({ path: rel, content: fs.readFileSync(src), binary: true, mode: rel === 'gradlew' ? 0o755 : undefined });
      }
    }

    return files;
  },

  /** Forge 没有每次生成都要刷新的 mixins.json；留空实现保持接口一致 */
  metadata() {
    return [];
  },

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
    return out;
  },

  handWritten(p) {
    const dir = `src/main/java/${p.meta.pkg.replace(/\./g, '/')}`;
    return [{ path: `${dir}/custom/CustomContent.java`, content: java.genCustomContent(p), createOnly: true }];
  },

  /** 可视化积木的事件接线 */
  visualWiring(p, info) {
    return visual.visualWiring(p, info);
  },

  /** 可视化积木的客户端接线（按键事件 → ModClient.java） */
  visualClientWiring(p, info) {
    return visual.visualClientWiring(p, info);
  },

  /**
   * 条目 → 注册表引用（per-entry 积木接线用来过滤「只有这个物品/方块才触发」）。
   *
   * ⚠️ Forge 用 DeferredRegister，字段是 RegistryObject<Item>/RegistryObject<Block>，
   * 不是直接的 Item/Block。比较时要调 .get() 取出真正的实例，
   * 否则 `getItem() == ModItems.X` 会因「Item vs RegistryObject<Item>」类型不匹配而编译失败。
   * （Fabric 字段就是 Item/Block，不需要 .get()。）
   */
  refs: {
    item(id) { return `ModItems.${toConstant(id)}.get()`; },
    block(id) { return `ModBlocks.${toConstant(id)}.get()`; },
  },
};
