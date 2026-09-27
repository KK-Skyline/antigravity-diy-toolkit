#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Antigravity 2K 2560*1440 60FPS 超清动态壁纸预设处理管线
支持:
  1. 视频壁纸 (.mp4 / .webm): 利用 PyAV (硬件级解码) 截取 60FPS 2K (2560x1440) 无缝循环动态 WebP + 高清原画
  2. 场景壁纸 (.pkg): 自动解析 PKGV/TEX 纹理包，提取原画材质并重采样至 2K 超清 (2560x1440)
  3. GIF 动态壁纸: 帧率重采样至 60FPS，超分至 2K 分辨率
"""

import os
import sys
import math
import time
from PIL import Image

TARGET_W = 2560
TARGET_H = 1440
TARGET_FPS = 60
LOOP_DURATION_SEC = 2.0
NUM_FRAMES = int(TARGET_FPS * LOOP_DURATION_SEC) # 120 帧

DURATIONS = [round((i + 1) * 1000 / TARGET_FPS) - round(i * 1000 / TARGET_FPS) for i in range(NUM_FRAMES)]

STEAM_WORKSHOP_ROOT = "E:/SteamLibrary/steamapps/workshop/content/431960"

# 创意工坊自带的 preview.gif 通常只是 160~400px 的正方形缩略图。
# 短边低于这个值的 GIF 不再放大成"2K 动图"——放大 10 倍以上只会得到拉伸变形的马赛克。
MIN_GIF_SIDE_FOR_UPSCALE = 720


def gif_is_hd(gif_path):
    """preview.gif 是否足够清晰，值得放大成 2K 动图"""
    try:
        with Image.open(gif_path) as g:
            return min(g.size) >= MIN_GIF_SIDE_FOR_UPSCALE
    except Exception:
        return False


def webp_is_upscaled_gif(webp_path, gif_path):
    """动图是否是旧版本把小缩略图 GIF 直接拉伸放大出来的：比较两者第一帧的缩略画面，几乎相同即判定为是。
    专门制作的高清动图（如露西、兵长）画面和缩略图不同，不会被误判。"""
    try:
        with Image.open(webp_path) as w, Image.open(gif_path) as g:
            if min(g.size) >= MIN_GIF_SIDE_FOR_UPSCALE:
                return False
            w.seek(0); g.seek(0)
            a = w.convert("L").resize((32, 18), Image.Resampling.BILINEAR)
            b = g.convert("L").resize((32, 18), Image.Resampling.BILINEAR)
            diff = sum(abs(x - y) for x, y in zip(a.getdata(), b.getdata())) / (32 * 18)
            return diff < 12
    except Exception:
        return False


def fit_16x9(img):
    """居中裁切成 16:9（不拉伸变形），比 2K 大就缩到 2K，比 2K 小就保持原尺寸（不做无意义的放大）"""
    w, h = img.size
    target_ratio = TARGET_W / TARGET_H
    if abs(w / h - target_ratio) > 0.01:
        if w / h > target_ratio:
            nw = round(h * target_ratio)
            img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / target_ratio)
            img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if img.width > TARGET_W:
        img = img.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
    return img

def find_wallpaper_dir(target):
    if os.path.isdir(target):
        return target
    # 尝试作为工坊 ID
    cand = os.path.join(STEAM_WORKSHOP_ROOT, str(target))
    if os.path.isdir(cand):
        return cand
    return None

def process_video_wallpaper(vpath, out_dir):
    """利用 PyAV 解码视频并导出 2K 60FPS 动态 WebP 和 2K 高清封面"""
    import av
    print(f"[2K-60FPS] 正在处理视频壁纸: {os.path.basename(vpath)}")
    container = av.open(vpath)
    stream = container.streams.video[0]
    
    in_fps = float(stream.average_rate) if stream.average_rate else 30.0
    print(f"  源视频信息: {stream.width}x{stream.height} @ {in_fps:.1f} fps, 编解码器: {stream.codec_context.name}")
    
    frames = []
    first_hd_img = None
    
    # 抽取 120 帧 (或根据源视频长度适当循环)
    step = max(1, round(in_fps / TARGET_FPS))
    count = 0
    
    for packet in container.demux(stream):
        for frame in packet.decode():
            if count % step == 0:
                img = frame.to_image().convert('RGB')
                if first_hd_img is None:
                    first_hd_img = img.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
                
                # 调整到 2K 分辨率 (保持 16:9)
                resized = img.resize((TARGET_W, TARGET_H), Image.Resampling.BILINEAR)
                frames.append(resized)
                if len(frames) >= NUM_FRAMES:
                    break
            count += 1
        if len(frames) >= NUM_FRAMES:
            break
            
    container.close()
    
    if not frames:
        print("  !! 视频解码失败或未提取到有效帧")
        return False
        
    # 如果视频较短帧数不够 120 帧，无缝往复/循环补齐
    while len(frames) < NUM_FRAMES:
        frames.extend(frames[:NUM_FRAMES - len(frames)])
        
    out_webp = os.path.join(out_dir, "preview_animated.webp")
    out_hd = os.path.join(out_dir, "preview_hd.jpg")
    
    # 保存 2K 静态底图
    if first_hd_img:
        first_hd_img.save(out_hd, quality=95)
        
    # 保存 2K 60FPS 动态 WebP
    print(f"  正在编码 2K 60FPS WebP ({len(frames)} 帧)...")
    frames[0].save(
        out_webp,
        format='WEBP',
        save_all=True,
        append_images=frames[1:],
        duration=DURATIONS[:len(frames)],
        loop=0,
        quality=75,
        method=1
    )
    sz_mb = os.path.getsize(out_webp) / (1024 * 1024)
    print(f"  √ 视频已升级为 2K 60FPS WebP! 文件大小: {sz_mb:.2f} MB")
    return True

# preview_hd.jpg 的生成算法版本。旧版本（取最大材质、丢弃透明通道）生成的原画会被自动重新生成。
HD_META_VERSION = 2


def hd_meta_version(wp_dir):
    import json
    try:
        with open(os.path.join(wp_dir, "preview_hd.meta.json"), "r", encoding="utf-8") as f:
            return int(json.load(f).get("version", 0))
    except Exception:
        return 0


def write_hd_meta(wp_dir, source):
    import json
    try:
        with open(os.path.join(wp_dir, "preview_hd.meta.json"), "w", encoding="utf-8") as f:
            json.dump({"version": HD_META_VERSION, "source": source}, f, ensure_ascii=False)
    except Exception:
        pass


def _decode_tex(pkg_path, data_start, off, ln):
    """解码 scene.pkg 里的一个 .tex 材质，保留透明通道"""
    import io
    import extract_scene_pkg
    data = extract_scene_pkg.read_entry(pkg_path, data_start, off, ln)
    header, images, image_format = extract_scene_pkg.parse_tex(data)
    for mips in images:
        if not mips:
            continue
        w, h, raw = mips[0]
        kind = extract_scene_pkg.tex_payload_kind(header, image_format, mips)
        img = None
        if kind in ("jpg", "png", "jpeg"):
            img = Image.open(io.BytesIO(raw))
        elif kind == "raw" and header.format == 0:
            img = Image.frombytes("RGBA", (w, h), raw)
        elif kind == "dds":
            dds = extract_scene_pkg.build_dds(w, h, extract_scene_pkg.DXT_FOURCC.get(header.format, b"DXT5"), mips)
            try:
                img = Image.open(io.BytesIO(dds))
            except Exception:
                pass
        if img is not None:
            return img
    return None


def _mostly_transparent(img):
    """人物层、贴纸层这类大部分透明的材质，单独拿出来当背景会出现色带和光晕"""
    if img.mode not in ("RGBA", "LA", "PA") and "transparency" not in img.info:
        return False
    a = img.convert("RGBA").getchannel("A").resize((64, 36))
    hist = a.histogram()
    return sum(hist[:20]) / (64 * 36) > 0.3


def _vec(value, n, default):
    try:
        vals = [float(v) for v in str(value).split()] if value is not None else []
    except ValueError:
        vals = []
    return (vals + [default] * n)[:n]


def composite_scene(pkg_path):
    """按 scene.json 的图层顺序、位置、尺寸和缩放，把所有可见图片层带透明通道叠成一张完整画面。
    （粒子、着色器特效无法静态还原，会被忽略）"""
    import json
    import extract_scene_pkg
    magic, entries, data_start = extract_scene_pkg.parse_pkg(pkg_path)
    index = {n: (o, l) for n, o, l in entries}

    def load_json(name):
        if name not in index:
            return None
        try:
            return json.loads(extract_scene_pkg.read_entry(pkg_path, data_start, *index[name]).decode("utf-8"))
        except Exception:
            return None

    scene = load_json("scene.json")
    if not scene:
        return None
    general = scene.get("general", {})
    proj = general.get("orthogonalprojection") or {}
    W, H = int(proj.get("width", 0) or 0), int(proj.get("height", 0) or 0)
    if W <= 0 or H <= 0:
        return None
    clear = tuple(min(255, max(0, round(c * 255))) for c in _vec(general.get("clearcolor"), 3, 0.0))
    canvas = Image.new("RGBA", (W, H), clear + (255,))
    layers = 0
    for ob in scene.get("objects", []):
        if "image" not in ob:
            continue
        visible = ob.get("visible", True)
        if isinstance(visible, dict):
            visible = visible.get("value", True)
        if visible is False:
            continue
        model = load_json(ob["image"])
        mat = load_json(model["material"]) if model and "material" in model else None
        try:
            tex_name = mat["passes"][0]["textures"][0]
        except (TypeError, KeyError, IndexError):
            continue
        key = "materials/" + str(tex_name) + ".tex"
        if not tex_name or key not in index:
            continue
        img = _decode_tex(pkg_path, data_start, *index[key])
        if img is None:
            continue
        img = img.convert("RGBA")
        sw, sh = _vec(ob.get("size"), 2, 0.0)
        if sw <= 0 or sh <= 0:
            sw, sh = img.size
        sx, sy, _ = _vec(ob.get("scale"), 3, 1.0)
        ox, oy, _ = _vec(ob.get("origin"), 3, 0.0)
        dw, dh = max(1, round(sw * abs(sx))), max(1, round(sh * abs(sy)))
        layer = img.resize((dw, dh), Image.Resampling.LANCZOS)
        # Wallpaper Engine 的场景坐标以左下角为原点、y 轴向上；origin 是图层中心
        left, top = round(ox - dw / 2), round((H - oy) - dh / 2)
        tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        tmp.paste(layer, (left, top))
        canvas = Image.alpha_composite(canvas, tmp)
        layers += 1
    if not layers:
        return None
    print(f"  已合成 {layers} 个图片层 (场景画布 {W}x{H})")
    return canvas.convert("RGB")


def process_scene_wallpaper(wp_dir):
    """处理场景壁纸: 从 scene.pkg 提取最高画质材质并升级至 2K"""
    pkg_path = os.path.join(wp_dir, "scene.pkg")
    if not os.path.isfile(pkg_path):
        return False
        
    out_hd = os.path.join(wp_dir, "preview_hd.jpg")
    out_webp = os.path.join(wp_dir, "preview_animated.webp")
    
    gif_path = os.path.join(wp_dir, "preview.gif")

    # 旧版本会把小缩略图 GIF 硬放大成"2K 动图"（马赛克 + 拉伸）。这种动图不能再用：
    # 改名备份，让读取器回退到清晰的 preview_hd.jpg。
    if os.path.isfile(out_webp) and os.path.isfile(gif_path) and webp_is_upscaled_gif(out_webp, gif_path):
        bad = os.path.join(wp_dir, "preview_animated.lowres-backup.webp")
        try:
            os.replace(out_webp, bad)
            print(f"  !! 检测到由低清缩略图放大的动图，已停用并备份为: {os.path.basename(bad)}")
        except Exception as e:
            print(f"  !! 停用低清动图失败: {e}")

    # 如果已经有可用的 2K WebP 或 2K 原画，跳过
    if os.path.isfile(out_webp) and os.path.getsize(out_webp) > 100000:
        return True
    if os.path.isfile(out_hd) and hd_meta_version(wp_dir) >= HD_META_VERSION:
        return True
        
    print(f"[2K-60FPS] 正在从 scene.pkg 提取超清材质: {pkg_path}")
    import extract_scene_pkg
    
    # 优先：按 scene.json 把背景层、人物层等带透明通道合成完整画面
    best_img = None
    hd_source = "composite"
    try:
        best_img = composite_scene(pkg_path)
    except Exception as e:
        print(f"  !! 场景图层合成失败，改用最大材质: {e}")
    magic, entries, data_start = extract_scene_pkg.parse_pkg(pkg_path)
    # 兜底：取最大的"不透明"材质（跳过大部分透明的人物层 / 贴纸层）
    best_pixel_count = float("inf") if best_img is not None else 0
    if best_img is None:
        hd_source = "largest-opaque-texture"
    
    import io
    for name, off, ln in entries:
        if name.lower().endswith(".tex"):
            try:
                data = extract_scene_pkg.read_entry(pkg_path, data_start, off, ln)
                header, images, image_format = extract_scene_pkg.parse_tex(data)
                for mips in images:
                    if not mips: continue
                    w, h, raw = mips[0]
                    kind = extract_scene_pkg.tex_payload_kind(header, image_format, mips)
                    
                    img = None
                    if kind in ("jpg", "png", "jpeg"):
                        img = Image.open(io.BytesIO(raw))
                    elif kind == "raw":
                        if header.format == 0:
                            img = Image.frombytes("RGBA", (w, h), raw)
                    elif kind == "dds":
                        dds = extract_scene_pkg.build_dds(w, h, extract_scene_pkg.DXT_FOURCC.get(header.format, b"DXT5"), mips)
                        try:
                            img = Image.open(io.BytesIO(dds))
                        except Exception:
                            pass
                            
                    if img and best_pixel_count != float("inf") and not _mostly_transparent(img):
                        pixels = img.width * img.height
                        if pixels > best_pixel_count:
                            best_pixel_count = pixels
                            best_img = img.convert('RGB')
            except Exception as e:
                pass
                
    if best_img:
        print(f"  提取到最大场景材质: {best_img.width}x{best_img.height}")
        # 居中裁成 16:9，不拉伸；大于 2K 才缩小
        hd_2k = fit_16x9(best_img)
        hd_2k.save(out_hd, quality=95)
        write_hd_meta(wp_dir, hd_source)
        print(f"  √ 超清静态原画已生成: preview_hd.jpg ({hd_2k.width}x{hd_2k.height})")

        # 只有 preview.gif 本身足够清晰时，才升级成 2K 60FPS 动图；小缩略图直接用静态原画
        if os.path.isfile(gif_path) and not gif_is_hd(gif_path):
            print(f"  preview.gif 只是低清缩略图，不放大成动图，使用静态原画。")
        elif os.path.isfile(gif_path):
            try:
                gif_im = Image.open(gif_path)
                n_frames = getattr(gif_im, 'n_frames', 1)
                if n_frames > 1:
                    print(f"  检测到动画 GIF ({n_frames} 帧)，正在升级为 2K 60FPS WebP...")
                    gif_frames = []
                    for idx in range(n_frames):
                        gif_im.seek(idx)
                        f_img = fit_16x9(gif_im.convert('RGB'))
                        gif_frames.append(f_img)
                        
                    # 扩增/平滑至 120 帧 60FPS
                    expanded = []
                    for i in range(NUM_FRAMES):
                        src_idx = int((i / NUM_FRAMES) * len(gif_frames))
                        expanded.append(gif_frames[min(src_idx, len(gif_frames) - 1)])
                        
                    expanded[0].save(
                        out_webp,
                        format='WEBP',
                        save_all=True,
                        append_images=expanded[1:],
                        duration=DURATIONS,
                        loop=0,
                        quality=80,
                        method=1
                    )
                    print(f"  √ GIF 已升级至 2K 60FPS WebP!")
                    return True
            except Exception as e:
                print(f"  !! GIF 升级失败: {e}")
                
        return True
        
    return False

def prepare_hd_wallpaper(target):
    wp_dir = find_wallpaper_dir(target)
    if not wp_dir:
        print(f"[错误] 未找到壁纸目录: {target}")
        return False
        
    print(f"[壁纸高清引擎] 正在检查并预设 2K 60FPS 资源: {wp_dir}")
    
    # 1. 检查是否存在直接视频文件
    import json
    project_file = os.path.join(wp_dir, "project.json")
    vpath = None
    if os.path.isfile(project_file):
        try:
            with open(project_file, 'r', encoding='utf-8') as f:
                pj = json.load(f)
                if pj.get('file') and (pj['file'].endswith('.mp4') or pj['file'].endswith('.webm')):
                    cand = os.path.join(wp_dir, pj['file'])
                    if os.path.isfile(cand):
                        vpath = cand
        except Exception:
            pass
            
    if not vpath:
        for f in os.listdir(wp_dir):
            if f.endswith('.mp4') or f.endswith('.webm'):
                vpath = os.path.join(wp_dir, f)
                break
                
    if vpath:
        # 如果已经存在 preview_animated.webp 且大小 > 500KB，跳过重复编码
        webp_cand = os.path.join(wp_dir, "preview_animated.webp")
        if os.path.isfile(webp_cand) and os.path.getsize(webp_cand) > 500000:
            print("  √ 2K 60FPS 动态壁纸资源已就绪，无需重复生成。")
            return True
        return process_video_wallpaper(vpath, wp_dir)
        
    # 2. 如果是 scene.pkg 场景壁纸
    scene_pkg = os.path.join(wp_dir, "scene.pkg")
    if os.path.isfile(scene_pkg):
        return process_scene_wallpaper(wp_dir)
        
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python prepare_hd_wallpaper.py <工坊ID或目录>")
        sys.exit(1)
    prepare_hd_wallpaper(sys.argv[1])
