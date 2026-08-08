# -*- coding: utf-8 -*-
"""
简化版Python Gemini 服务
适配 google-genai 新库
"""

import os
import time
import json
import sys
import urllib3
from google import genai
from gemini_cli_args import parse_video_cli_args

DEFAULT_MODEL = os.getenv('GEMINI_DEFAULT_MODEL') or 'gemini-3.6-flash'

# 设置UTF-8编码输出，解决Windows控制台显示问题
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

class GeminiService:
    def __init__(self, api_key=None, debug=False):
        """初始化Gemini服务"""
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        self.debug = debug
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY 环境变量未设置")
        self.client = genai.Client(api_key=self.api_key)
        if self.debug:
            print("✅ Gemini Client 初始化成功", file=sys.stderr)

    def analyze_video(self, video_path, prompt, model=None, temperature=0.7):
        """分析视频内容，先上传视频文件再调用 Gemini API"""
        model = model or DEFAULT_MODEL
        try:
            if not os.path.exists(video_path):
                return {
                    'success': False,
                    'error': '视频文件不存在'
                }
            if self.debug:
                print("📹 开始上传视频", file=sys.stderr)
            # 1. 上传视频文件，获得文件对象
            myfile = self.client.files.upload(file=video_path)
            if self.debug:
                print(f"✅ 视频文件上传成功: {getattr(myfile, 'name', None)}", file=sys.stderr)
            # 2. 轮询等待文件状态变为 ACTIVE，最多60秒
            wait_time = 0
            while getattr(myfile, 'state', None) != 'ACTIVE' and wait_time < 60:
                if self.debug:
                    print(f"⏳ 等待文件状态变为 ACTIVE，当前状态: {getattr(myfile, 'state', None)}", file=sys.stderr)
                time.sleep(1)
                wait_time += 1
                myfile = self.client.files.get(name=myfile.name)
            if getattr(myfile, 'state', None) != 'ACTIVE':
                return {
                    'success': False,
                    'error': f'文件未能在 60 秒内变为 ACTIVE，当前状态: {getattr(myfile, 'state', None)}'
                }
            # 3. 生成内容，引用文件对象
            config = genai.types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=8192
            )
            response = self.client.models.generate_content(
                model=model,
                contents=[prompt, myfile],
                config=config
            )
            if self.debug:
                print("🎉 视频分析完成", file=sys.stderr)
            return {
                'success': True,
                'text': response.text,
                'file_id': getattr(myfile, 'name', None),
                'usage': {}
            }
        except Exception as e:
            error_msg = str(e)
            if self.debug:
                print("❌ 视频分析失败", file=sys.stderr)
            return {
                'success': False,
                'error': error_msg
            }

    def generate_text(self, content, system_instruction=None, model=None, temperature=0.7):
        """生成文本内容"""
        model = model or DEFAULT_MODEL
        try:
            if self.debug:
                print("📝 开始生成文本", file=sys.stderr)
            config = genai.types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=8192
            )
            response = self.client.models.generate_content(
                model=model,
                contents=content,
                config=config
            )
            if self.debug:
                print("🎉 文本生成完成", file=sys.stderr)
            return {
                'success': True,
                'text': response.text,
                'usage': {}
            }
        except Exception as e:
            error_msg = str(e)
            if self.debug:
                print("❌ 文本生成失败", file=sys.stderr)
            return {
                'success': False,
                'error': error_msg
            }



def main():
    import json
    result = None
    try:
        if len(sys.argv) < 2:
            result = {'success': False, 'error': '缺少命令参数'}
            print(json.dumps(result, ensure_ascii=False))
            return
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            result = {'success': False, 'error': 'GEMINI_API_KEY 环境变量未设置'}
            print(json.dumps(result, ensure_ascii=False))
            return
        debug_mode = os.getenv('GEMINI_DEBUG', 'false').lower() == 'true'
        if debug_mode:
            print(f"[DEBUG] 初始化GeminiService, debug={debug_mode}", file=sys.stderr)
        service = GeminiService(api_key, debug=debug_mode)
        command = sys.argv[1]
        if debug_mode:
            print(f"[DEBUG] 执行命令: {command}", file=sys.stderr)
        if command == "video":
            if '--stdin' in sys.argv:
                try:
                    data = json.loads(sys.stdin.read())
                    video_path = data.get('videoPath', '')
                    prompt = data.get('prompt', '')
                    model_config = data.get('modelConfig', {})
                    if not video_path:
                        raise ValueError('缺少视频路径参数')
                    video_args = {
                        'video_path': video_path,
                        'prompt': prompt,
                        'model': model_config.get('model') or DEFAULT_MODEL,
                        'temperature': model_config.get('temperature', 0.7),
                    }
                except Exception:
                    result = {'success': False, 'error': 'stdin数据解析失败'}
                    print(json.dumps(result, ensure_ascii=False))
                    return
            else:
                if len(sys.argv) < 3:
                    result = {'success': False, 'error': '缺少视频路径参数'}
                    print(json.dumps(result, ensure_ascii=False))
                    return
                video_args = parse_video_cli_args(sys.argv[2:], DEFAULT_MODEL)
            result = service.analyze_video(
                video_args['video_path'],
                video_args['prompt'],
                video_args['model'],
                video_args['temperature']
            )
            print(json.dumps(result, ensure_ascii=False))
        elif command == "text":
            # 检查是否使用stdin输入
            if '--stdin' in sys.argv:
                # 从stdin读取JSON数据
                try:
                    stdin_data = sys.stdin.read()
                    data = json.loads(stdin_data)
                    content = data.get('prompt', '')
                    system_instruction = data.get('systemInstruction')
                    model_config = data.get('modelConfig', {})
                    if debug_mode:
                        print(f"[DEBUG] 从stdin读取到数据，大小: {len(stdin_data)} 字符", file=sys.stderr)
                except Exception as e:
                    result = {'success': False, 'error': f'stdin数据解析失败: {str(e)}'}
                    print(json.dumps(result, ensure_ascii=False))
                    return
            else:
                # 从命令行参数读取
                if len(sys.argv) < 3:
                    result = {'success': False, 'error': '缺少文本内容参数'}
                    print(json.dumps(result, ensure_ascii=False))
                    return
                content = sys.argv[2]
                system_instruction = sys.argv[3] if len(sys.argv) > 3 else None
                model_config = {}
                if len(sys.argv) > 4 and sys.argv[4].startswith('{'):
                    try:
                        model_config = json.loads(sys.argv[4])
                    except json.JSONDecodeError as e:
                        print("[ERROR] JSON解析失败", file=sys.stderr)
            
            model = model_config.get('model') or DEFAULT_MODEL
            temperature = model_config.get('temperature', 0.7)
            result = service.generate_text(content, system_instruction, model, temperature)
            print(json.dumps(result, ensure_ascii=False))
            
        elif command == "text_stream":
            result = {'success': False, 'error': '流式响应功能已移除，请使用text命令'}
            print(json.dumps(result, ensure_ascii=False))
        elif command == "test":
            # 测试Gemini API连接
            if debug_mode:
                print("[DEBUG] 测试Gemini API连接", file=sys.stderr)
            try:
                # 简单的文本生成测试
                test_content = "Hello, this is a connection test."
                result = service.generate_text(test_content, None, DEFAULT_MODEL, 0.7)
                if result['success']:
                    result['message'] = 'Gemini API连接测试成功'
                    result['responseTime'] = 'N/A'  # 可以添加计时逻辑
                print(json.dumps(result, ensure_ascii=False))
            except Exception as e:
                result = {'success': False, 'error': f'连接测试失败: {str(e)}'}
                print(json.dumps(result, ensure_ascii=False))
        else:
            result = {'success': False, 'error': f'未知命令: {command}'}
            print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        if os.getenv('GEMINI_DEBUG', 'false').lower() == 'true':
            print("[ERROR] Gemini service command failed", file=sys.stderr)
        result = {'success': False, 'error': str(e)}
        print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
