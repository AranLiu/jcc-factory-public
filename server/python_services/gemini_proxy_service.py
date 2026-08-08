# -*- coding: utf-8 -*-
"""
Gemini 代理服务
基于 Cloudflare 代理实现，支持视频和文本分析
"""

import os
import sys
import json
import time
import requests
from pathlib import Path

DEFAULT_MODEL = os.getenv('GEMINI_DEFAULT_MODEL') or 'gemini-3.6-flash'

# 设置UTF-8编码输出，解决Windows控制台显示问题
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

class GeminiProxyService:
    def __init__(self, debug=False):
        """初始化代理服务"""
        self.debug = debug
        
        # 从环境变量读取配置
        self.proxy_url = os.getenv('PROXY_SERVICE_URL', '')
        self.auth_token = os.getenv('PROXY_SERVICE_AUTH_TOKEN')
        self.current_model = DEFAULT_MODEL
        
        if not self.auth_token:
            raise ValueError("PROXY_SERVICE_AUTH_TOKEN 环境变量未设置")
        
        # 构造通用请求头
        self.common_headers = {
            'Authorization': f'Bearer {self.auth_token}'
        }
        
        if self.debug:
            print(f"✅ Gemini代理服务初始化成功", file=sys.stderr)
            print(f"   代理URL: {self.proxy_url}", file=sys.stderr)
            print(f"   当前模型: {self.current_model}", file=sys.stderr)

    def test_connection(self):
        """测试代理连接"""
        try:
            if self.debug:
                print(f"🔍 开始测试代理连接...", file=sys.stderr)
            
            start_time = time.time()
            
            # 使用简单的文本生成测试连接
            test_content = "Hello, this is a connection test."
            result = self.generate_text(test_content)
            
            end_time = time.time()
            response_time = (end_time - start_time) * 1000
            
            if result['success']:
                return {
                    'success': True,
                    'message': '代理服务连接正常',
                    'response_text': result.get('text', ''),
                    'responseTime': response_time
                }
            else:
                return {
                    'success': False,
                    'message': '代理服务连接失败',
                    'error': result.get('error', 'Unknown error'),
                    'responseTime': response_time
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': '代理连接测试异常'
            }

    def generate_text(self, content, model=None):
        """生成文本内容（通过代理）"""
        try:
            if self.debug:
                print(f"📝 开始通过代理生成文本", file=sys.stderr)
                print(f"🤖 使用模型: {model or self.current_model}", file=sys.stderr)
            
            # 构造API端点
            target_model = model or self.current_model
            analyze_url = f"{self.proxy_url}/v1beta/models/{target_model}:generateContent"
            
            # 根据模型类型设置不同的超时时间
            if 'pro' in target_model.lower():
                request_timeout = 300  # 5分钟，pro模型需要更多时间
            else:
                request_timeout = 120  # 2分钟，flash模型相对较快
            
            if self.debug:
                print(f"⏰ 设置超时时间: {request_timeout}秒", file=sys.stderr)
            
            # 构造请求数据
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": content}
                        ]
                    }
                ]
            }
            
            # 设置请求头
            headers = self.common_headers.copy()
            headers['Content-Type'] = 'application/json'
            
            # 发送请求
            response = requests.post(analyze_url, headers=headers, json=payload, timeout=request_timeout)
            response.raise_for_status()
            
            # 解析响应
            result = response.json()
            
            if self.debug:
                print(f"🎉 文本生成完成", file=sys.stderr)
            
            return {
                'success': True,
                'text': result['candidates'][0]['content']['parts'][0]['text'],
                'usage': {}
            }
            
        except Exception as e:
            error_msg = str(e)
            if self.debug:
                print(f"❌ 文本生成失败: {error_msg}", file=sys.stderr)
            return {
                'success': False,
                'error': error_msg
            }



    def analyze_video(self, video_path, prompt, model=None):
        """分析视频内容（通过代理）"""
        file_name_for_google = ""
        
        try:
            if not os.path.exists(video_path):
                return {
                    'success': False,
                    'error': f'视频文件不存在: {video_path}'
                }
            
            if self.debug:
                print(f"📹 开始通过代理分析视频: {video_path}", file=sys.stderr)
                print(f"🤖 使用模型: {model or self.current_model}", file=sys.stderr)
            
            # 阶段一：上传视频文件
            if self.debug:
                print(f"--- 阶段一：正在上传视频文件 ---", file=sys.stderr)
            
            upload_url = f"{self.proxy_url}/upload/v1beta/files"
            
            with open(video_path, 'rb') as video_file:
                files = {'file': video_file}
                upload_response = requests.post(upload_url, headers=self.common_headers, files=files)
                upload_response.raise_for_status()
            
            upload_result = upload_response.json()
            file_uri = upload_result['file']['uri']
            file_name_for_google = upload_result['file']['name']
            
            if self.debug:
                print(f"✅ 视频上传成功，文件URI: {file_uri}", file=sys.stderr)
            
            # 阶段二：轮询文件处理状态
            if self.debug:
                print(f"--- 阶段二：等待文件处理完成 ---", file=sys.stderr)
            
            status_url = f"{self.proxy_url}/v1beta/{file_name_for_google}"
            
            while True:
                status_response = requests.get(status_url, headers=self.common_headers)
                status_response.raise_for_status()
                status_result = status_response.json()
                
                current_state = status_result['state']
                if current_state == "ACTIVE":
                    if self.debug:
                        print("✅ 文件处理完成，状态: ACTIVE", file=sys.stderr)
                    break
                elif current_state == "FAILED":
                    raise ValueError("视频文件处理失败！请检查视频格式或内容。")
                else:
                    if self.debug:
                        print("⏳ 文件仍在处理中，等待10秒...", file=sys.stderr)
                    time.sleep(10)
            
            # 阶段三：发送分析请求
            if self.debug:
                print(f"--- 阶段三：发送视频分析请求 ---", file=sys.stderr)
            
            target_model = model or self.current_model
            analyze_url = f"{self.proxy_url}/v1beta/models/{target_model}:generateContent"
            
            # 构造分析请求数据
            analyze_payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {"fileData": {"mimeType": "video/mp4", "fileUri": file_uri}}
                        ]
                    }
                ]
            }
            
            # 设置请求头
            analyze_headers = self.common_headers.copy()
            analyze_headers['Content-Type'] = 'application/json'
            
            # 发送分析请求
            analyze_response = requests.post(analyze_url, headers=analyze_headers, json=analyze_payload)
            analyze_response.raise_for_status()
            
            # 解析结果
            final_result = analyze_response.json()
            
            if self.debug:
                print(f"🎉 视频分析完成", file=sys.stderr)
            
            return {
                'success': True,
                'text': final_result['candidates'][0]['content']['parts'][0]['text'],
                'file_id': file_name_for_google,
                'usage': {}
            }
            
        except Exception as e:
            error_msg = str(e)
            if self.debug:
                print(f"❌ 视频分析失败: {error_msg}", file=sys.stderr)
            return {
                'success': False,
                'error': error_msg
            }
        
        finally:
            # 阶段四：清理服务器上的临时文件
            if file_name_for_google:
                try:
                    if self.debug:
                        print(f"--- 阶段四：清理临时文件 {file_name_for_google} ---", file=sys.stderr)
                    
                    delete_url = f"{self.proxy_url}/v1beta/{file_name_for_google}"
                    delete_response = requests.delete(delete_url, headers=self.common_headers)
                    
                    if delete_response.status_code == 200:
                        if self.debug:
                            print("✅ 临时文件清理成功", file=sys.stderr)
                    else:
                        if self.debug:
                            print(f"⚠️ 删除文件失败，状态码: {delete_response.status_code}", file=sys.stderr)
                            
                except Exception as delete_err:
                    if self.debug:
                        print(f"⚠️ 删除文件时发生错误: {delete_err}", file=sys.stderr)

def main():
    """命令行入口函数"""
    result = None
    try:
        if len(sys.argv) < 2:
            result = {'success': False, 'error': '缺少命令参数'}
            print(json.dumps(result, ensure_ascii=False))
            return
        
        debug_mode = os.getenv('GEMINI_DEBUG', 'false').lower() == 'true'
        service = GeminiProxyService(debug=debug_mode)
        
        command = sys.argv[1]
        
        if command == "text":
            # 检查是否使用stdin输入
            if '--stdin' in sys.argv:
                # 从stdin读取JSON数据
                try:
                    stdin_data = sys.stdin.read()
                    data = json.loads(stdin_data)
                    content = data.get('prompt', '')
                    model_config = data.get('modelConfig', {})
                    model = model_config.get('model')
                    
                    print(f"[DEBUG] 从stdin读取到数据，大小: {len(stdin_data)} 字符", file=sys.stderr)
                    result = service.generate_text(content, model)
                except Exception as e:
                    result = {'success': False, 'error': f'stdin数据解析失败: {str(e)}'}
            else:
                # 从命令行参数读取
                if len(sys.argv) < 3:
                    result = {'success': False, 'error': '缺少文本内容参数'}
                else:
                    content = sys.argv[2]
                    model = sys.argv[3] if len(sys.argv) > 3 else None
                    result = service.generate_text(content, model)
                
        elif command == "text_stream":
            result = {'success': False, 'error': '流式响应功能已移除，请使用text命令'}

        elif command == "video":
            if '--stdin' in sys.argv:
                try:
                    data = json.loads(sys.stdin.read())
                    video_path = data.get('videoPath', '')
                    prompt = data.get('prompt', '')
                    model_config = data.get('modelConfig', {})
                    if not video_path:
                        raise ValueError('缺少视频路径参数')
                    result = service.analyze_video(
                        video_path,
                        prompt,
                        model_config.get('model')
                    )
                except Exception:
                    result = {'success': False, 'error': 'stdin数据解析失败'}
            else:
                if len(sys.argv) < 4:
                    result = {'success': False, 'error': '缺少视频路径或提示词参数'}
                else:
                    video_path = sys.argv[2]
                    prompt = sys.argv[3]
                    model = sys.argv[4] if len(sys.argv) > 4 else None
                    result = service.analyze_video(video_path, prompt, model)
                
        elif command == "test":
            result = service.test_connection()
            
        else:
            result = {'success': False, 'error': f'未知命令: {command}'}
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        result = {'success': False, 'error': str(e)}
        print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
