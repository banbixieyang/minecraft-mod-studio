package com.example.util;

import net.minecraft.world.entity.Entity;

/** 测试夹具：一个带 public static 方法的工具类。 */
public class Tool {
    public static int damage(Entity target, int amount) { return amount; }
    public static void reset(Entity target) { }
    public static int hidden() { return 0; }
    protected static int protectedOne() { return 0; }
    public int notStatic() { return 0; }
}
