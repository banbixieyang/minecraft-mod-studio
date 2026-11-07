/**
 * 自定义结构生成器 —— 「完全自定义 Java 类型」路线。
 *
 * 一个条目产出四样东西：
 *   1. data/<ns>/worldgen/structure/<id>.json       结构的配置（群系 / 阶段 / 地形修饰）
 *   2. data/<ns>/worldgen/structure_set/<id>.json   结构集（间距 / 间隔 / 盐）—— 群系的 starts 引用它
 *   3. java/<pkg>/world/structure/<X>Structure.java  自定义 Structure 子类（决定生成点）
 *   4. java/<pkg>/world/structure/<X>Piece.java      自定义 StructurePiece（按配置摆方块，不需要 .nbt）
 * 外加一个注册表 java/<pkg>/world/ModStructures.java。
 *
 * 为什么不用 .nbt 拼块：用户要的是「在编辑器里改几个数字就能生成一座塔」，
 * 而不是先去外部工具做模型。方块盒（可空心、可点缀、可放宝箱）覆盖了绝大多数
 * 小型结构的需求，而且改配置就能重新生成。
 *
 * 两个目标的差异都在 API 上：
 *   Fabric 26.3 → Identifier / MapCodec / BuiltInRegistries.X.getValue / ResourceKey<LootTable>
 *   Forge 1.20.1 → ResourceLocation / Codec / BuiltInRegistries.X.get / ResourceLocation（战利品表）
 * 注册方式也不同：Fabric 在 onInitialize 里直接 Registry.register；
 * Forge 用 @Mod.EventBusSubscriber + RegisterEvent。
 */
import { toPascal, toConstant } from '../../core/ids.mjs';

const j = (o) => JSON.stringify(o, null, 2);

function clampInt(v, dflt, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function clampNum(v, dflt, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/** 方块 id 归一化：没有命名空间就补 minecraft，空值给 fallback */
function blockId(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  return s.includes(':') ? s : `minecraft:${s}`;
}

/** 群系 id 归一化：没有命名空间就补本模组 */
function biomeId(v, ns) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.includes(':') ? s : `${ns}:${s}`;
}

/**
 * 把条目摊平成生成器能直接用的形状。
 *
 * ⚠️ 这里必须把所有表单字段都读一遍（两个目标共用）：
 * 「假旋钮」测试（tests/fields.mjs）会核对 module.json 声明的字段是否真的被读过。
 */
function normalize(e, ns) {
  const id = String(e.id || '').trim();
  const rawBiomes = Array.isArray(e.biomes) ? e.biomes : [];
  const biomes = rawBiomes.map((x) => String(x).trim()).filter(Boolean);
  const step = String(e.step || 'surface_structures');
  const terrain = String(e.terrain_adaptation || 'none');
  const spacing = clampInt(e.spacing, 32, 1, 512);
  const separation = clampInt(e.separation, 8, 0, 512);
  const salt = clampInt(e.salt, 0, 0, 2147483647);

  const wall = blockId(e.block, 'minecraft:stone_bricks');
  const accentRaw = String(e.accentBlock || '').trim();
  const accent = accentRaw ? blockId(accentRaw, '') : '';
  const accentChance = clampNum(e.accentChance, 0.15, 0, 1);
  const width = clampInt(e.width, 9, 3, 63);
  // 取奇数，保证 (x1+x2)/2 正好是中心格
  const half = Math.max(1, Math.floor(width / 2));
  const height = clampInt(e.height, 12, 3, 128);
  const hollow = e.hollow !== false;
  const floorRaw = String(e.floorBlock || '').trim();
  const floor = floorRaw ? blockId(floorRaw, wall) : wall;
  const lootRaw = String(e.lootTable || '').trim();
  const loot = lootRaw ? (lootRaw.includes(':') ? lootRaw : `${ns}:${lootRaw}`) : '';

  return {
    id,
    cls: toPascal(id) || 'Structure',
    constant: toConstant(id) || 'STRUCTURE',
    biomes,
    step,
    terrain,
    spacing,
    separation,
    salt,
    wall,
    accent,
    accentChance,
    half,
    height,
    hollow,
    floor,
    loot,
  };
}

/** 结构 JSON 的 biomes：支持 all / * 展开成本模组的全部群系 */
function resolveBiomes(s, ns, allBiomeIds) {
  const lower = s.biomes.map((x) => x.toLowerCase());
  if (lower.includes('all') || lower.includes('*')) {
    return allBiomeIds.length ? allBiomeIds : '#minecraft:is_overworld';
  }
  const list = s.biomes.map((x) => biomeId(x, ns)).filter(Boolean);
  if (list.length) return list;
  // 什么都没填：有自建群系就全用，否则退回主世界
  return allBiomeIds.length ? allBiomeIds : '#minecraft:is_overworld';
}

function buildStructureJson(s, ns, allBiomeIds) {
  const out = {
    type: `${ns}:${s.id}`,
    biomes: resolveBiomes(s, ns, allBiomeIds),
    spawn_overrides: {},
    step: s.step,
  };
  if (s.terrain && s.terrain !== 'none') out.terrain_adaptation = s.terrain;
  return out;
}

function buildSetJson(s, ns) {
  return {
    structures: [{ structure: `${ns}:${s.id}`, weight: 1 }],
    placement: {
      type: 'minecraft:random_spread',
      salt: s.salt,
      separation: s.separation,
      spacing: s.spacing,
    },
  };
}

// ============================================================
// Java
// ============================================================

function structureJava(s, pkg, codecType) {
  const imports = [
    'import java.util.Optional;',
    `import com.mojang.serialization.${codecType};`,
    'import net.minecraft.world.level.ChunkPos;',
    'import net.minecraft.world.level.levelgen.Heightmap;',
    'import net.minecraft.world.level.levelgen.structure.Structure;',
    'import net.minecraft.world.level.levelgen.structure.StructureType;',
    'import net.minecraft.world.level.levelgen.structure.pieces.StructurePiecesBuilder;',
    `import ${pkg}.world.ModStructures;`,
  ];
  return `package ${pkg}.world.structure;

${imports.join('\n')}

/**
 * 由 MC Studio 生成的「${s.id}」结构。
 *
 * <p>只在落点决定「在哪建」，具体摆什么方块交给 ${s.cls}Piece。
 * 群系 / 生成阶段 / 地形修饰都写在 data/&lt;ns&gt;/worldgen/structure/${s.id}.json 里。
 */
public class ${s.cls}Structure extends Structure {
    public static final ${codecType}<${s.cls}Structure> CODEC = simpleCodec(${s.cls}Structure::new);

    public ${s.cls}Structure(StructureSettings settings) {
        super(settings);
    }

    @Override
    public StructureType<?> type() {
        return ModStructures.${s.constant};
    }

    @Override
    protected Optional<GenerationStub> findGenerationPoint(GenerationContext ctx) {
        return onTopOfChunkCenter(ctx, Heightmap.Types.WORLD_SURFACE_WG, builder -> addPieces(ctx, builder));
    }

    private static void addPieces(GenerationContext ctx, StructurePiecesBuilder builder) {
        ChunkPos cp = ctx.chunkPos();
        int cx = cp.getMiddleBlockX();
        int cz = cp.getMiddleBlockZ();
        int y = ctx.chunkGenerator().getFirstFreeHeight(cx, cz, Heightmap.Types.WORLD_SURFACE_WG,
                ctx.heightAccessor(), ctx.randomState());
        builder.addPiece(new ${s.cls}Piece(cx, y, cz));
    }
}
`;
}

function pieceJava(s, pkg, variant) {
  const fabric = variant === 'fabric';
  const imports = [
    'import net.minecraft.core.BlockPos;',
    'import net.minecraft.core.registries.BuiltInRegistries;',
    'import net.minecraft.nbt.CompoundTag;',
    'import net.minecraft.util.RandomSource;',
    'import net.minecraft.world.level.ChunkPos;',
    'import net.minecraft.world.level.StructureManager;',
    'import net.minecraft.world.level.WorldGenLevel;',
    'import net.minecraft.world.level.block.state.BlockState;',
    'import net.minecraft.world.level.chunk.ChunkGenerator;',
    'import net.minecraft.world.level.levelgen.structure.BoundingBox;',
    'import net.minecraft.world.level.levelgen.structure.StructurePiece;',
    'import net.minecraft.world.level.levelgen.structure.pieces.StructurePieceSerializationContext;',
    `import ${pkg}.world.ModStructures;`,
  ];
  if (fabric) {
    imports.push('import net.minecraft.core.registries.Registries;');
    imports.push('import net.minecraft.resources.Identifier;');
    imports.push('import net.minecraft.resources.ResourceKey;');
    imports.push('import net.minecraft.world.level.storage.loot.LootTable;');
  } else {
    imports.push('import net.minecraft.resources.ResourceLocation;');
  }

  const stateFn = fabric
    ? `    private static BlockState state(String id) {
        net.minecraft.world.level.block.Block block = BuiltInRegistries.BLOCK.getValue(Identifier.parse(id));
        if (block == null) block = BuiltInRegistries.BLOCK.getValue(Identifier.parse("minecraft:stone_bricks"));
        return block.defaultBlockState();
    }`
    : `    private static BlockState state(String id) {
        net.minecraft.world.level.block.Block block = BuiltInRegistries.BLOCK.get(new ResourceLocation(id));
        if (block == null) block = BuiltInRegistries.BLOCK.get(new ResourceLocation("minecraft:stone_bricks"));
        return block.defaultBlockState();
    }`;

  const lootField = s.loot
    ? fabric
      ? `    private static final ResourceKey<LootTable> LOOT =
            ResourceKey.create(Registries.LOOT_TABLE, Identifier.parse(${JSON.stringify(s.loot)}));`
      : `    private static final ResourceLocation LOOT = new ResourceLocation(${JSON.stringify(s.loot)});`
    : `    private static final ${fabric ? 'ResourceKey<LootTable>' : 'ResourceLocation'} LOOT = null;`;

  const fillBlock = s.hollow ? 'minecraft:air' : s.wall;

  return `package ${pkg}.world.structure;

${imports.join('\n')}

/**
 * 由 MC Studio 生成的「${s.id}」结构拼块。
 *
 * <p>形状是一路方块盒：宽 ${s.half * 2 + 1} × 高 ${s.height}，${s.hollow ? '空心（内部空气）' : '实心'}。
 * 主方块 ${s.wall}${s.accent ? `，点缀 ${s.accent}（概率 ${Math.round(s.accentChance * 100)}%）` : ''}${s.loot ? `，中心放一个宝箱（${s.loot}）` : ''}。
 * 这些参数在生成时就写进代码了，改配置后重新生成即可。
 */
public class ${s.cls}Piece extends StructurePiece {
    private static final BlockState WALL = state(${JSON.stringify(s.wall)});
    private static final BlockState FLOOR = state(${JSON.stringify(s.floor)});
    private static final BlockState FILL = state(${JSON.stringify(fillBlock)});
    private static final BlockState ACCENT = ${s.accent ? `state(${JSON.stringify(s.accent)})` : 'null'};
    private static final float ACCENT_CHANCE = ${Number(s.accentChance.toFixed(3))}f;
${lootField}

    public ${s.cls}Piece(int cx, int y, int cz) {
        super(ModStructures.${s.constant}_PIECE, 0,
                new BoundingBox(cx - ${s.half}, y, cz - ${s.half}, cx + ${s.half}, y + ${s.height - 1}, cz + ${s.half}));
    }

    public ${s.cls}Piece(StructurePieceSerializationContext ctx, CompoundTag tag) {
        super(ModStructures.${s.constant}_PIECE, tag);
    }

${stateFn}

    @Override
    protected void addAdditionalSaveData(StructurePieceSerializationContext ctx, CompoundTag tag) {
        // 形状参数都已经编译进代码，不需要额外存档数据
    }

    @Override
    public void postProcess(WorldGenLevel level, StructureManager manager, ChunkGenerator generator,
                            RandomSource random, BoundingBox box, ChunkPos chunkPos, BlockPos pos) {
        BoundingBox bb = this.boundingBox;
        int x1 = bb.minX();
        int y1 = bb.minY();
        int z1 = bb.minZ();
        int x2 = bb.maxX();
        int y2 = bb.maxY();
        int z2 = bb.maxZ();

        // 主体：外圈用 WALL，内部用 FILL（空心时是空气）
        this.generateBox(level, box, x1, y1, z1, x2, y2, z2, WALL, FILL, false);
        // 地板单独一层，方便和墙体用不同材质
        this.generateBox(level, box, x1, y1, z1, x2, y1, z2, FLOOR, FLOOR, false);

        // 随机点缀：只替换外壳表面，不碰内部
        if (ACCENT != null) {
            for (int x = x1; x <= x2; x++) {
                for (int y = y1; y <= y2; y++) {
                    for (int z = z1; z <= z2; z++) {
                        boolean shell = x == x1 || x == x2 || y == y1 || y == y2 || z == z1 || z == z2;
                        if (shell && random.nextFloat() < ACCENT_CHANCE) {
                            this.placeBlock(level, ACCENT, x, y, z, box);
                        }
                    }
                }
            }
        }

        // 中心宝箱（只有填了战利品表才放）
        if (LOOT != null) {
            this.createChest(level, box, random, (x1 + x2) / 2, y1 + 1, (z1 + z2) / 2, LOOT);
        }
    }
}
`;
}

function hubJava(rows, ns, pkg, variant) {
  const fabric = variant === 'fabric';
  const typeFields = rows
    .map(
      (s) =>
        `    public static final StructureType<${s.cls}Structure> ${s.constant} =\n            () -> ${s.cls}Structure.CODEC;`,
    )
    .join('\n');
  const pieceFields = rows
    .map((s) => `    public static final StructurePieceType ${s.constant}_PIECE = ${s.cls}Piece::new;`)
    .join('\n');

  const imports = [
    'import net.minecraft.world.level.levelgen.structure.StructureType;',
    'import net.minecraft.world.level.levelgen.structure.pieces.StructurePieceType;',
    ...rows.flatMap((s) => [
      `import ${pkg}.world.structure.${s.cls}Piece;`,
      `import ${pkg}.world.structure.${s.cls}Structure;`,
    ]),
  ];

  if (fabric) {
    imports.unshift(
      'import net.minecraft.core.Registry;',
      'import net.minecraft.core.registries.BuiltInRegistries;',
      'import net.minecraft.resources.Identifier;',
    );
    const regs = rows
      .map(
        (s) =>
          `        Registry.register(BuiltInRegistries.STRUCTURE_TYPE,
                Identifier.fromNamespaceAndPath(NS, ${JSON.stringify(s.id)}), ${s.constant});
        Registry.register(BuiltInRegistries.STRUCTURE_PIECE,
                Identifier.fromNamespaceAndPath(NS, ${JSON.stringify(s.id)}), ${s.constant}_PIECE);`,
      )
      .join('\n');

    return `package ${pkg}.world;

${imports.join('\n')}

/**
 * 由 MC Studio「结构」生成的注册表。
 *
 * <p>自定义结构类型与拼块类型必须在数据包加载前注册好，
 * 所以主类 onInitialize 会调用一次 {@link #init()}。
 */
public final class ModStructures {
    public static final String NS = ${JSON.stringify(ns)};

${typeFields}
${pieceFields}

    public static void init() {
${regs}
    }

    private ModStructures() {
    }
}
`;
  }

  imports.unshift(
    'import net.minecraft.core.registries.Registries;',
    'import net.minecraft.resources.ResourceLocation;',
    'import net.minecraftforge.eventbus.api.SubscribeEvent;',
    'import net.minecraftforge.fml.common.Mod;',
    'import net.minecraftforge.registries.RegisterEvent;',
  );
  const regs = rows
    .map(
      (s) =>
        `        event.register(Registries.STRUCTURE_TYPE, new ResourceLocation(NS, ${JSON.stringify(s.id)}),
                () -> ${s.constant});
        event.register(Registries.STRUCTURE_PIECE, new ResourceLocation(NS, ${JSON.stringify(s.id)}),
                () -> ${s.constant}_PIECE);`,
    )
    .join('\n');

  return `package ${pkg}.world;

${imports.join('\n')}

/**
 * 由 MC Studio「结构」生成的注册表。
 *
 * <p>Forge 用 RegisterEvent 注册结构类型与拼块类型；
 * 类上的 {@code @Mod.EventBusSubscriber} 会让 Forge 自动发现它，
 * 不需要改主类。
 */
@Mod.EventBusSubscriber(modid = ${JSON.stringify(ns)}, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ModStructures {
    public static final String NS = ${JSON.stringify(ns)};

${typeFields}
${pieceFields}

    @SubscribeEvent
    public static void register(RegisterEvent event) {
${regs}
    }

    private ModStructures() {
    }
}
`;
}

export default {
  emit(ctx) {
    const entries = ctx.entriesOf('structure');
    if (!entries.length) return;
    const { adapter, ns, pkg } = ctx;
    const dir = pkg.replace(/\./g, '/');
    const variant = adapter.id === 'fabric-26.3' ? 'fabric' : 'forge';
    const codecType = variant === 'fabric' ? 'MapCodec' : 'Codec';

    const allBiomeIds = ctx
      .entriesOf('biome')
      .map((b) => String(b.id || '').trim())
      .filter(Boolean)
      .map((id) => biomeId(id, ns));

    const rows = entries.map((e) => normalize(e, ns)).filter((s) => s.id);
    if (!rows.length) return;

    for (const s of rows) {
      ctx.addFile(
        `src/main/resources/data/${ns}/worldgen/structure/${s.id}.json`,
        j(buildStructureJson(s, ns, allBiomeIds)),
      );
      ctx.addFile(
        `src/main/resources/data/${ns}/worldgen/structure_set/${s.id}.json`,
        j(buildSetJson(s, ns)),
      );
      ctx.addFile(
        `src/main/java/${dir}/world/structure/${s.cls}Structure.java`,
        structureJava(s, pkg, codecType, s.constant),
      );
      ctx.addFile(`src/main/java/${dir}/world/structure/${s.cls}Piece.java`, pieceJava(s, pkg, variant));
    }

    ctx.addFile(`src/main/java/${dir}/world/ModStructures.java`, hubJava(rows, ns, pkg, variant));
  },
};
