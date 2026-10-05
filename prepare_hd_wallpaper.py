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


def _is_blank(img):
    """合成失败时得到的是几乎没有变化的图（纯黑 / 纯白 / 纯色）。
    只看"变化幅度"，不看"亮不亮"：星空、暗色剪影、白底线稿这类很暗或很亮的真实画面不能被误判。"""
    from PIL import ImageStat
    g = img.convert("L").resize((128, 72))
    lo, hi = g.getextrema()
    return hi - lo < 12 or ImageStat.Stat(g).stddev[0] < 3


def _vec(value, n, default):
    # 带脚本的属性形如 {"script": "...", "value": "1 1 1"}，取其中的静态值
    if isinstance(value, dict):
        value = value.get("value")
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


SCENE_VIDEO_NAME = "scene_video.mp4"


def extract_scene_video(wp_dir, pkg_path):
    """有些场景壁纸的主画面是一段嵌在 .tex 材质里的 MP4（贴图格式为 mp4），静态合成只能得到空白。
    把它提取成 scene_video.mp4，交给运行时的 <video> 原视频播放通道（GPU 解码、原分辨率、完整时长）。
    只认覆盖画布一半以上的可见图层，避免把角落里的小装饰动画当成壁纸。成功返回视频路径，否则 None。"""
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
    proj = scene.get("general", {}).get("orthogonalprojection") or {}
    W, H = int(proj.get("width", 0) or 0), int(proj.get("height", 0) or 0)
    if W <= 0 or H <= 0:
        return None
    best = None
    for ob in scene.get("objects", []):
        visible = ob.get("visible", True)
        if isinstance(visible, dict):
            visible = visible.get("value", True)
        if "image" not in ob or visible is False:
            continue
        model = load_json(ob["image"])
        mat = load_json(model["material"]) if model and "material" in model else None
        try:
            key = "materials/" + str(mat["passes"][0]["textures"][0]) + ".tex"
        except (TypeError, KeyError, IndexError):
            continue
        if key not in index:
            continue
        header, images, image_format = extract_scene_pkg.parse_tex(extract_scene_pkg.read_entry(pkg_path, data_start, *index[key]))
        if not images or not images[0] or extract_scene_pkg.tex_payload_kind(header, image_format, images[0]) != "mp4":
            continue
        sw, sh = _vec(ob.get("size"), 2, 0.0)
        sx, sy, _ = _vec(ob.get("scale"), 3, 1.0)
        area = sw * abs(sx) * sh * abs(sy)
        if area >= 0.5 * W * H and (best is None or area > best[0]):
            best = (area, images[0][0][2])
    if best is None:
        return None
    raw = best[1]
    out = os.path.join(wp_dir, SCENE_VIDEO_NAME)
    if not (os.path.isfile(out) and os.path.getsize(out) == len(raw)):
        tmp = out + ".tmp"
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, out)
        print(f"  √ 场景主画面是嵌入视频，已提取为 {SCENE_VIDEO_NAME} ({len(raw) / 1024 / 1024:.1f} MB)")
    return out


def write_video_poster(video_path, out_hd, at_seconds=1.0):
    """截取视频约 1 秒处的一帧作为封面（视频加载完成前显示、也用于取色）。
    很多视频开头是黑场：跳过空白帧，取之后第一张有内容的画面，最多找到第 15 秒。"""
    import av
    img = last = None
    with av.open(video_path) as container:
        for frame in container.decode(container.streams.video[0]):
            t = frame.time
            if t is not None and t < at_seconds:
                last = frame
                continue
            img = frame.to_image()
            if t is None or t > 15 or not _is_blank(img):
                break
    if img is None and last is not None:  # 视频短于 at_seconds
        img = last.to_image()
    if img is None:
        return False
    fit_16x9(img.convert("RGB")).save(out_hd, quality=92)
    return True


def process_scene_wallpaper(wp_dir):
    """处理场景壁纸: 从 scene.pkg 提取最高画质材质并升级至 2K"""
    pkg_path = os.path.join(wp_dir, "scene.pkg")
    if not os.path.isfile(pkg_path):
        return False
        
    out_hd = os.path.join(wp_dir, "preview_hd.jpg")
    out_webp = os.path.join(wp_dir, "preview_animated.webp")
    
    gif_path = os.path.join(wp_dir, "preview.gif")

    # 主画面是嵌入视频的场景：提取原视频，走视频播放通道；封面只在缺失时生成
    try:
        scene_video = extract_scene_video(wp_dir, pkg_path)
    except Exception as e:
        scene_video = None
        print(f"  !! 检查场景嵌入视频失败: {e}")
    if scene_video:
        if not os.path.isfile(out_hd):
            try:
                if write_video_poster(scene_video, out_hd):
                    write_hd_meta(wp_dir, "scene-video")
                    print("  √ 已从视频截取封面: preview_hd.jpg")
            except Exception as e:
                print(f"  !! 截取视频封面失败（不影响视频播放）: {e}")
        return True

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
        try:
            with Image.open(out_hd) as existing:
                if not _is_blank(existing):
                    return True
            print("  !! 已有的 preview_hd.jpg 是空白图，停用并重新生成")
            try:
                os.replace(out_hd, os.path.join(wp_dir, "preview_hd.blank-backup.jpg"))
            except Exception as e:
                print(f"  !! 停用空白图失败: {e}")
        except Exception as e:
            # 已有原画打不开（损坏 / 写了一半）：重新生成，而不是继续沿用坏文件
            print(f"  !! 已有的 preview_hd.jpg 无法读取（{e}），重新生成")

    print(f"[2K-60FPS] 正在从 scene.pkg 提取超清材质: {pkg_path}")
    import extract_scene_pkg
    
    # 优先：按 scene.json 把背景层、人物层等带透明通道合成完整画面
    best_img = None
    hd_source = "composite"
    try:
        best_img = composite_scene(pkg_path)
    except Exception as e:
        print(f"  !! 场景图层合成失败，改用最大材质: {e}")
    if best_img is not None and _is_blank(best_img):
        print("  !! 场景图层合成结果是空白图，改用最大材质")
        best_img = None
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
                
    if best_img is not None and _is_blank(best_img):
        print("  !! 提取到的材质也是空白图，放弃生成 preview_hd.jpg，沿用官方预览图")
        best_img = None
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
        # 视频壁纸运行时直接播放原视频（不再转动图）；这里只确保有一张有内容的封面，
        # 用于视频加载完成前显示和取色。旧版本截的是第一帧，常常是黑场。
        out_hd = os.path.join(wp_dir, "preview_hd.jpg")
        try:
            with Image.open(out_hd) as existing:
                need_poster = _is_blank(existing)
        except Exception:
            need_poster = True
        if need_poster:
            if os.path.isfile(out_hd):
                os.replace(out_hd, os.path.join(wp_dir, "preview_hd.blank-backup.jpg"))
                print("  !! 已有的视频封面是空白图，已停用并重新截取")
            try:
                if write_video_poster(vpath, out_hd):
                    write_hd_meta(wp_dir, "video")
                    print("  √ 已从视频截取封面: preview_hd.jpg")
            except Exception as e:
                print(f"  !! 截取视频封面失败（不影响视频播放）: {e}")
        return True
        
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
