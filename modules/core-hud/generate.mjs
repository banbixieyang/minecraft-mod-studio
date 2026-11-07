/**
 * 自定义 HUD 面板生成器。
 *
 * 每个条目 = 一块游戏内的叠层界面（像小地图 / 状态条 mod 那样），
 * 把选中的变量（生命值、坐标、游戏模式……）画在屏幕一角。
 *
 * 双目标都走「配置 + 切换键」方案：
 *   · 生成时写出 config/<ns>/hud/<id>.properties 模板（编辑器里就能改）
 *   · 进游戏后这份文件由 ModHud 自动加载，改完保存、按切换键（或等几秒）即时生效
 *   · 每个面板有独立切换键，出现在游戏的「按键设置」里，玩家可改键
 *
 * 为什么用配置而不是写死：这样中文用户不用重新生成 / 重新打包，
 * 直接改 properties 就能调位置、颜色、显示哪些变量。
 *
 * ⚠️ 渲染用的 API 已经按目标分派：
 *   Fabric 26.3 → HudRenderCallback（GuiGraphics）
 *   Forge 1.20.1 → RenderGuiEvent.Post（GuiGraphics）
 *   两个目标都用 GuiGraphics.drawString / fill，差异只在事件挂载。
 */

/** 可显示的变量清单：key → { 中文名, 取值表达式 }。表达式按目标分派。 */
const VARS = {
  health: { zh: '当前生命值', fabric: 'String.format("%.1f", player.getHealth())', forge: 'String.format("%.1f", player.getHealth())' },
  max_health: { zh: '最大生命值', fabric: 'String.format("%.1f", player.getMaxHealth())', forge: 'String.format("%.1f", player.getMaxHealth())' },
  pos_x: { zh: 'X 坐标', fabric: 'String.valueOf((int) player.getX())', forge: 'String.valueOf((int) player.getX())' },
  pos_y: { zh: 'Y 坐标', fabric: 'String.valueOf((int) player.getY())', forge: 'String.valueOf((int) player.getY())' },
  pos_z: { zh: 'Z 坐标', fabric: 'String.valueOf((int) player.getZ())', forge: 'String.valueOf((int) player.getZ())' },
  game_mode: { zh: '游戏模式', fabric: 'player.gameMode().getName()', forge: 'player.gameMode.getName()' },
};

const ANCHORS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];

/** 把 #RRGGBB / #RRGGBBAA 解析成 0xAARRGGBB 的整数；解析不出就回退默认值 */
function colorToInt(hex, dflt) {
  if (!hex) return dflt;
  let s = String(hex).replace('#', '').trim().toLowerCase();
  if (s.length === 6) s = 'ff' + s;
  if (s.length !== 8) return dflt;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = parseInt(s.slice(6, 8), 16);
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return dflt;
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

function hex8(c) {
  return (c >>> 0).toString(16).padStart(8, '0');
}

/** 归一化变量列表：只保留 VARS 里认识的 key */
function normVars(e) {
  const v = Array.isArray(e.vars) ? e.vars : [];
  return v.filter((k) => VARS[k]);
}

function buildPanel(e, i) {
  const id = e.id || `hud${i}`;
  const anchor = ANCHORS.includes(e.anchor) ? e.anchor : 'top_left';
  const toggleKey = String(e.toggleKey || 'KEY_H').replace(/^GLFW_/, '');
  return {
    id,
    title: e.title || '状态面板',
    anchor,
    offsetX: Number(e.offsetX) || 0,
    offsetY: Number(e.offsetY) || 0,
    scale: Number(e.scale) || 1,
    bg: colorToInt(e.bgColor, 0x000000aa),
    fg: colorToInt(e.textColor, 0xffffffff),
    lineGap: Number(e.lineSpacing) || 14,
    vars: normVars(e),
    visible: e.visible !== false,
    // 按键常量：Fabric 用 InputConstants.<KEY>，Forge 用 GLFW.GLFW_<KEY>
    toggleConstFabric: `com.mojang.blaze3d.platform.InputConstants.${toggleKey}`,
    toggleConstForge: `org.lwjgl.glfw.GLFW.GLFW_${toggleKey}`,
  };
}

/** 共享的 Java 核心：Panel 类、取值、绘制、配置读写、颜色/数字解析 */
function coreJava(ns, gmExpr) {
  return `
    private static final class Panel {
        final String id;
        String title;
        String anchor;
        int offsetX;
        int offsetY;
        float scale;
        int bg;
        int fg;
        int lineGap;
        java.util.List<String> vars;
        boolean visible;
        net.minecraft.client.KeyMapping key;
        Panel(String id, String title, String anchor, int offsetX, int offsetY, float scale, int bg, int fg, int lineGap, java.util.List<String> vars, boolean visible) {
            this.id = id; this.title = title; this.anchor = anchor;
            this.offsetX = offsetX; this.offsetY = offsetY; this.scale = scale;
            this.bg = bg; this.fg = fg; this.lineGap = lineGap; this.vars = vars; this.visible = visible;
        }
    }

    private static String valueOf(net.minecraft.client.player.LocalPlayer player, String key) {
        switch (key) {
            case "health": return "HP " + String.format("%.1f", player.getHealth());
            case "max_health": return "MAX " + String.format("%.1f", player.getMaxHealth());
            case "pos_x": return "X " + (int) player.getX();
            case "pos_y": return "Y " + (int) player.getY();
            case "pos_z": return "Z " + (int) player.getZ();
            case "game_mode": return "MODE " + ${gmExpr};
            default: return key;
        }
    }

    private static void drawPanel(net.minecraft.client.gui.GuiGraphics gui, net.minecraft.client.Minecraft mc, net.minecraft.client.player.LocalPlayer player, Panel p) {
        if (p.vars == null || p.vars.isEmpty()) return;
        java.util.List<String> lines = new java.util.ArrayList<String>();
        lines.add(p.title);
        for (String v : p.vars) lines.add(valueOf(player, v));
        int lh = (int) Math.max(12, p.lineGap * p.scale);
        int w = 12;
        for (String s : lines) w = Math.max(w, mc.font.width(s) + 12);
        int h = lines.size() * lh + 8;
        int sw = mc.getWindow().getGuiScaledWidth();
        int sh = mc.getWindow().getGuiScaledHeight();
        int x = p.offsetX;
        int y = p.offsetY;
        if (p.anchor.indexOf("right") >= 0) x = sw - w - p.offsetX;
        if (p.anchor.indexOf("bottom") >= 0) y = sh - h - p.offsetY;
        gui.fill(x, y, x + w, y + h, p.bg);
        int cy = y + 4;
        for (String s : lines) {
            gui.drawString(mc.font, net.minecraft.network.chat.Component.literal(s), x + 6, cy, p.fg, false);
            cy += lh;
        }
    }

    private static int parseInt(String s, int dflt) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return dflt; }
    }

    private static float parseFloat(String s, float dflt) {
        try { return Float.parseFloat(s.trim()); } catch (Exception e) { return dflt; }
    }

    private static int parseColor(String s, int dflt) {
        if (s == null) return dflt;
        String h = s.trim().replace("#", "");
        if (h.length() == 6) h = "ff" + h;
        if (h.length() != 8) return dflt;
        try {
            int r = Integer.parseInt(h.substring(0, 2), 16);
            int g = Integer.parseInt(h.substring(2, 4), 16);
            int b = Integer.parseInt(h.substring(4, 6), 16);
            int a = Integer.parseInt(h.substring(6, 8), 16);
            return (a << 24) | (r << 16) | (g << 8) | b;
        } catch (Exception e) { return dflt; }
    }

    private static String hex8(int c) { return String.format("%08x", c); }

    private static java.nio.file.Path configFile(String id) {
        return CONFIGDIR.resolve("${ns}").resolve("hud").resolve(id + ".properties");
    }

    /** applyVisible=true 只在首次加载时把配置文件里的 visible 读进来；
     *  之后靠切换键控制，周期重载只更新布局，避免刚按下去又被配置盖回去。 */
    private static void loadConfig(Panel p, boolean applyVisible) {
        java.nio.file.Path f = configFile(p.id);
        java.util.Properties props = new java.util.Properties();
        try {
            if (!java.nio.file.Files.exists(f)) {
                java.nio.file.Files.createDirectories(f.getParent());
                try (java.io.OutputStream out = java.nio.file.Files.newOutputStream(f)) {
                    props.setProperty("visible", String.valueOf(p.visible));
                    props.setProperty("anchor", p.anchor);
                    props.setProperty("offsetX", String.valueOf(p.offsetX));
                    props.setProperty("offsetY", String.valueOf(p.offsetY));
                    props.setProperty("scale", String.valueOf(p.scale));
                    props.setProperty("lineSpacing", String.valueOf(p.lineGap));
                    props.setProperty("bgColor", "#" + hex8(p.bg));
                    props.setProperty("textColor", "#" + hex8(p.fg));
                    props.setProperty("vars", String.join(",", p.vars));
                    props.store(out, "HUD panel " + p.id + " - 改完保存，按切换键或等几秒生效");
                }
            } else {
                try (java.io.InputStream in = java.nio.file.Files.newInputStream(f)) { props.load(in); }
                if (applyVisible) p.visible = Boolean.parseBoolean(props.getProperty("visible", String.valueOf(p.visible)));
                p.anchor = props.getProperty("anchor", p.anchor);
                p.offsetX = parseInt(props.getProperty("offsetX"), p.offsetX);
                p.offsetY = parseInt(props.getProperty("offsetY"), p.offsetY);
                p.scale = parseFloat(props.getProperty("scale"), p.scale);
                p.lineGap = parseInt(props.getProperty("lineSpacing"), p.lineGap);
                p.bg = parseColor(props.getProperty("bgColor"), p.bg);
                p.fg = parseColor(props.getProperty("textColor"), p.fg);
                String vs = props.getProperty("vars");
                if (vs != null && !vs.trim().isEmpty()) {
                    java.util.List<String> list = new java.util.ArrayList<String>();
                    for (String s : vs.split(",")) { s = s.trim(); if (!s.isEmpty()) list.add(s); }
                    p.vars = list;
                }
            }
        } catch (Exception ex) { /* 配置读不出来就用默认值 */ }
    }
`;
}

function panelLiteral(p) {
  const varsArr = 'java.util.Arrays.asList(' + p.vars.map((v) => `"${v}"`).join(', ') + ')';
  return `new Panel(${JSON.stringify(p.id)}, ${JSON.stringify(p.title)}, ${JSON.stringify(p.anchor)}, ${p.offsetX}, ${p.offsetY}, ${p.scale}f, ${p.bg}, ${p.fg}, ${p.lineGap}, ${varsArr}, ${p.visible})`;
}

function configTemplate(ns, p) {
  return `# ${p.title} 面板配置（mod id: ${ns}）
# 改完保存，回到游戏按 ${p.toggleConstFabric.replace('com.mojang.blaze3d.platform.InputConstants.', 'KEY_')} 切换显示，或等几秒自动生效
# 颜色格式 #RRGGBBAA（最后两位是透明度，00 全透明 ~ ff 不透明）
visible=${p.visible}
anchor=${p.anchor}
offsetX=${p.offsetX}
offsetY=${p.offsetY}
scale=${p.scale}
lineSpacing=${p.lineGap}
bgColor=#${hex8(p.bg)}
textColor=#${hex8(p.fg)}
# 要显示的变量（逗号分隔，顺序即显示顺序）：health, max_health, pos_x, pos_y, pos_z, game_mode
vars=${p.vars.join(',')}
`;
}

// ============================================================
// Fabric 26.3
// ============================================================
function fabricJava(ns, pkg, dir, panels) {
  const panelStatic = panels.map((p) => `        PANELS.add(${panelLiteral(p)});`).join('\n');
  const keyReg = panels.map((p, i) => `        PANELS.get(${i}).key = new net.minecraft.client.KeyMapping(
                "${ns}.hud_toggle.${p.id}",
                com.mojang.blaze3d.platform.InputConstants.Type.KEYBOARD,
                ${p.toggleConstFabric},
                net.minecraft.client.KeyMapping.Category.MISC);
        net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper.registerKeyMapping(PANELS.get(${i}).key);`).join('\n');

  return `package ${pkg}.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.gui.GuiGraphics;

/**
 * 由 MC Studio「自定义界面」生成的 HUD 叠层。
 *
 * <p>每个面板的位置、颜色、要显示的变量都写在 config/${ns}/hud/<id>.properties，
 * 改完保存即可（按切换键或等几秒）。切换键出现在游戏「按键设置」里。
 */
public class ModHud implements ClientModInitializer {
    private static final String NS = "${ns}";
    private static final java.nio.file.Path CONFIGDIR = FabricLoader.getInstance().getConfigDir();
    private static int tick = 0;
    private static final java.util.List<Panel> PANELS = new java.util.ArrayList<Panel>();
    static {
${panelStatic}
    }
${coreJava(ns, VARS.game_mode.fabric)}

    @Override
    public void onInitializeClient() {
        for (int i = 0; i < PANELS.size(); i++) loadConfig(PANELS.get(i), true);
${keyReg}

        HudRenderCallback.EVENT.register((gui, tickDelta) -> {
            Minecraft mc = Minecraft.getInstance();
            LocalPlayer player = mc.player;
            if (player == null) return;
            tick++;
            for (Panel p : PANELS) {
                if (tick % 40 == 0) loadConfig(p, false);
                if (p.visible) drawPanel(gui, mc, player, p);
            }
        });

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            for (Panel p : PANELS) {
                if (p.key != null && p.key.consumeClick()) {
                    p.visible = !p.visible;
                    loadConfig(p, false);
                }
            }
        });
    }
}
`;
}

// ============================================================
// Forge 1.20.1
// ============================================================
function forgeJava(ns, pkg, dir, panels) {
  const panelStatic = panels.map((p) => `        PANELS.add(${panelLiteral(p)});`).join('\n');
  const keyReg = panels.map((p, i) => `            PANELS.get(${i}).key = new net.minecraft.client.KeyMapping(
                    "${ns}.hud_toggle.${p.id}",
                    ${p.toggleConstForge},
                    "${ns}.key.category");
            event.register(PANELS.get(${i}).key);`).join('\n');

  return `package ${pkg}.client;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLPaths;

/**
 * 由 MC Studio「自定义界面」生成的 HUD 叠层。
 *
 * <p>每个面板的位置、颜色、要显示的变量都写在 config/${ns}/hud/<id>.properties，
 * 改完保存即可（按切换键或等几秒）。切换键出现在游戏「按键设置」里。
 */
public final class ModHud {
    private static final String NS = "${ns}";
    private static final java.nio.file.Path CONFIGDIR = FMLPaths.CONFIGDIR.get();
    private static int tick = 0;
    private static final java.util.List<Panel> PANELS = new java.util.ArrayList<Panel>();
    static {
${panelStatic}
    }
${coreJava(ns, VARS.game_mode.forge)}

    private ModHud() {
    }

    /** 键位注册（MOD 总线） */
    @Mod.EventBusSubscriber(modid = NS, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
    public static final class KeySetup {
        @SubscribeEvent
        public static void registerKeys(RegisterKeyMappingsEvent event) {
            for (int i = 0; i < PANELS.size(); i++) loadConfig(PANELS.get(i), true);
${keyReg}
        }

        private KeySetup() {
        }
    }

    /** HUD 渲染（FORGE 总线） */
    @Mod.EventBusSubscriber(modid = NS, value = Dist.CLIENT)
    public static final class Hud {
        @SubscribeEvent
        public static void onRender(RenderGuiEvent.Post event) {
            Minecraft mc = Minecraft.getInstance();
            LocalPlayer player = mc.player;
            if (player == null) return;
            tick++;
            GuiGraphics gui = event.getGuiGraphics();
            for (Panel p : PANELS) {
                if (tick % 40 == 0) loadConfig(p, false);
                if (p.visible) drawPanel(gui, mc, player, p);
            }
        }

        @SubscribeEvent
        public static void onClientTick(TickEvent.ClientTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;
            for (Panel p : PANELS) {
                if (p.key != null && p.key.consumeClick()) {
                    p.visible = !p.visible;
                    loadConfig(p, false);
                }
            }
        }

        private Hud() {
        }
    }
}
`;
}

export default {
  emit(ctx) {
    const entries = ctx.entriesOf('hud');
    if (!entries.length) return;
    const { adapter, ns, pkg } = ctx;
    const dir = pkg.replace(/\./g, '/');
    const panels = entries.map((e, i) => buildPanel(e, i));

    const java = adapter.id === 'fabric-26.3' ? fabricJava(ns, pkg, dir, panels) : forgeJava(ns, pkg, dir, panels);
    ctx.addFile(`src/main/java/${dir}/client/ModHud.java`, java);

    for (const p of panels) {
      ctx.addFile(`config/${ns}/hud/${p.id}.properties`, configTemplate(ns, p));
    }
  },
};
