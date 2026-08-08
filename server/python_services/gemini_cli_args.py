"""Dependency-free parsing for Gemini subprocess argument contracts."""

import json
import sys


DEFAULT_TEMPERATURE = 0.7


def parse_video_cli_args(args, default_model):
    """Parse video arguments without importing the Gemini SDK or echoing input."""
    if not args:
        raise ValueError("缺少视频路径参数")

    video_path = args[0]
    prompt = args[1] if len(args) > 1 else "Analyze this video"
    model_config = {}
    if len(args) > 2 and args[2]:
        model_config = json.loads(args[2])
        if not isinstance(model_config, dict):
            raise ValueError("模型配置必须是JSON对象")

    return {
        "video_path": video_path,
        "prompt": prompt,
        "model_config": model_config,
        "model": model_config.get("model") or default_model,
        "temperature": model_config.get("temperature", DEFAULT_TEMPERATURE),
    }


def main(argv=None):
    """Expose a safe parser probe for cross-runtime contract tests."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 2:
        raise ValueError("用法: gemini_cli_args.py DEFAULT_MODEL VIDEO_PATH [PROMPT] [MODEL_CONFIG_JSON]")

    parsed = parse_video_cli_args(argv[1:], argv[0])
    print(json.dumps({
        "model": parsed["model"],
        "temperature": parsed["temperature"],
        "configKeys": sorted(parsed["model_config"].keys()),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
