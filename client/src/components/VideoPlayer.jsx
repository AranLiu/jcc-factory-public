import React, { useState, useRef, useEffect } from 'react';
import { Button, message } from 'antd';
import { PlayCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { secureFetch } from '../services/httpSecurity';

const VideoPlayer = ({ file, canDownload = true, showMeta = true, fill = false }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [isLoadingLocked, setIsLoadingLocked] = useState(false); // 防止并发加载
  const videoRef = useRef(null);
  const loadingRef = useRef(false); // 用ref确保最新状态

  // 生成视频流URL - 使用本地API
  const getVideoStreamUrl = (targetFile) => `/api/files/${targetFile.id}/stream`;

  const [videoUrl, setVideoUrl] = useState(null);

  // 使用fetch获取视频blob URL
  const loadVideo = async () => {
    if (!file) {
      console.warn('没有文件信息，跳过视频加载');
      return;
    }

    // 防止并发加载
    if (loadingRef.current || isLoadingLocked) {
      console.log('⏸️ 已有加载任务进行中，跳过重复请求');
      return;
    }
    
    console.log('🔒 开始加载，设置锁定状态');
    loadingRef.current = true;
    setIsLoadingLocked(true);
    setLoading(true);
    setError(null);
    
    try {
      const streamUrl = getVideoStreamUrl(file);
      console.log('🎬 开始加载视频:', {
        fileId: file.id,
        fileName: file.original_name,
        streamUrl: streamUrl
      });
      
      const response = await secureFetch(streamUrl, {
        headers: {
          'Range': 'bytes=0-' // 初始范围请求
        }
      });
      
      console.log('📡 服务器响应:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('Content-Type'),
        contentLength: response.headers.get('Content-Length'),
        url: response.url
      });
      
      if (!response.ok) {
        throw new Error(`服务器错误 ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      console.log('📦 Blob生成成功:', {
        size: blob.size,
        type: blob.type
      });
      
      const blobUrl = URL.createObjectURL(blob);
      setVideoUrl(blobUrl);
      console.log('✅ 视频blob URL生成成功:', blobUrl);
      
      // 成功时释放锁
      loadingRef.current = false;
      setIsLoadingLocked(false);
      setLoading(false);
      
    } catch (error) {
      console.error('❌ Blob方案失败:', error);
      console.log('🔄 立即切换到备用URL方案...');
      
      // 清理任何现有的blob URL
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      
      // 直接设置为null，让video使用getFallbackVideoUrl
      setVideoUrl(null);
      setLoading(false);
      
      // 释放锁
      loadingRef.current = false;
      setIsLoadingLocked(false);
      
      // 立即重新加载video元素
      setTimeout(() => {
        if (videoRef.current) {
          console.log('🔄 重新加载video元素，使用备用URL');
          videoRef.current.load();
        }
      }, 50);
    }
  };

  useEffect(() => {
    if (file && !loadingRef.current && !isLoadingLocked) {
      console.log('🎯 选择视频加载策略...');
      
      // 添加简化模式开关 - 如果环境变量设置了SIMPLE_VIDEO_MODE，直接使用URL方案
      const useSimpleMode = localStorage.getItem('useSimpleVideoMode') === 'true';
      
      if (useSimpleMode) {
        console.log('🔧 使用简化视频模式，直接使用URL方案');
        setVideoUrl(null);
        setLoading(false);
        if (videoRef.current) {
          setTimeout(() => videoRef.current.load(), 50);
        }
        return;
      }
      
      // 尝试blob方案
      loadVideo();
    }
    
    // 清理函数
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      // 清理时释放锁
      loadingRef.current = false;
      setIsLoadingLocked(false);
    };
  }, [file]);

  // 原有的URL生成函数（作为备用）
  const getFallbackVideoUrl = () => `/api/files/${file.id}/stream`;

  // 检查浏览器支持的视频格式
  const checkVideoSupport = () => {
    const video = document.createElement('video');
    const formats = {
      'video/mp4': video.canPlayType('video/mp4'),
      'video/webm': video.canPlayType('video/webm'),
      'video/ogg': video.canPlayType('video/ogg'),
      'video/avi': video.canPlayType('video/avi'),
      'video/mov': video.canPlayType('video/mov'),
    };
    console.log('浏览器支持的视频格式:', formats);
    return formats;
  };

  useEffect(() => {
    checkVideoSupport();
    
    // 添加开发者工具到全局window对象
    if (typeof window !== 'undefined') {
      window.videoPlayerDebug = {
        enableSimpleMode: () => {
          localStorage.setItem('useSimpleVideoMode', 'true');
          console.log('✅ 简化视频模式已启用，刷新页面生效');
        },
        disableSimpleMode: () => {
          localStorage.setItem('useSimpleVideoMode', 'false');
          console.log('✅ Blob视频模式已启用，刷新页面生效');
        },
        getCurrentMode: () => {
          const mode = localStorage.getItem('useSimpleVideoMode') === 'true' ? 'Simple URL' : 'Blob';
          console.log(`当前模式: ${mode}`);
          return mode;
        },
        forceRetry: () => {
          if (typeof handleRetry === 'function') {
            handleRetry();
          }
        }
      };
    }
  }, []);

  const handleVideoError = (e) => {
    console.error('🚨 视频播放错误:', e);
    const video = e.target;
    let errorMessage = '视频播放失败';
    let errorDetails = '';
    
    if (video && video.error) {
      console.log('📋 视频Error对象:', {
        code: video.error.code,
        message: video.error.message,
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        networkState: video.networkState
      });
      
      switch (video.error.code) {
        case video.error.MEDIA_ERR_ABORTED:
          errorMessage = '视频播放被中止';
          errorDetails = '播放被用户或程序中止';
          break;
        case video.error.MEDIA_ERR_NETWORK:
          errorMessage = '网络错误';
          errorDetails = '网络连接问题，无法加载视频';
          break;
        case video.error.MEDIA_ERR_DECODE:
          errorMessage = '视频解码错误';
          errorDetails = '视频文件可能损坏或格式不支持';
          break;
        case video.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = '不支持的视频格式';
          errorDetails = '浏览器不支持此视频格式或MIME类型';
          break;
        default:
          errorMessage = '未知播放错误';
          errorDetails = `错误代码: ${video.error.code}`;
      }
    } else if (e.target && e.target.error) {
      // 处理从loadVideo传入的自定义错误
      errorMessage = '加载错误';
      errorDetails = e.target.error.message;
    }
    
    setError({
      message: errorMessage,
      details: errorDetails,
      url: videoUrl || getFallbackVideoUrl(),
      fileName: file.original_name,
      mimeType: file.mime_type
    });
  };

  const handleVideoLoad = () => {
    console.log('视频加载成功');
    if (videoRef.current) {
      const video = videoRef.current;
      setVideoInfo({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        canPlay: true
      });
    }
  };

  const handleLoadStart = () => {
    console.log('开始加载视频');
    setLoading(true);
    setError(null);
  };

  const handleCanPlay = () => {
    console.log('视频可以播放');
    setLoading(false);
  };

  const handleDownload = () => {
    window.open(getFallbackVideoUrl(), '_blank');
  };

  const handleRetry = () => {
    console.log('🔄 用户点击重试');
    
    // 重置所有状态
    setError(null);
    setLoading(false);
    loadingRef.current = false;
    setIsLoadingLocked(false);
    
    // 清理旧的blob URL
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    
    // 短暂延迟后重新获取视频
    setTimeout(() => {
      loadVideo();
    }, 100);
  };

  if (error) {
    return (
      <div style={{ 
        border: '1px dashed #d9d9d9', 
        borderRadius: '6px', 
        padding: '20px', 
        textAlign: 'center',
        backgroundColor: '#fafafa'
      }}>
        <div style={{ color: '#ff4d4f', marginBottom: '12px' }}>
          ⚠️ {error.message}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
          详情: {error.details}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
          文件: {error.fileName}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
          MIME类型: {error.mimeType}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px', wordBreak: 'break-all' }}>
          路径: {error.url}
        </div>
        <div>
          <Button 
            type="primary" 
            size="small" 
            onClick={handleRetry}
            style={{ marginRight: '8px' }}
          >
            重试播放
          </Button>
          <Button 
            size="small" 
            icon={<DownloadOutlined />}
            onClick={handleDownload}
          >
            下载文件
          </Button>
        </div>
      </div>
    );
  }

  const containerStyle = fill 
    ? { width: '100%', height: '100%' }
    : { width: '100%', maxWidth: '800px' };

  const videoStyle = fill 
    ? { width: '100%', height: '100%', backgroundColor: '#000', borderRadius: '4px', objectFit: 'contain' }
    : { width: '100%', maxHeight: '400px', backgroundColor: '#000', borderRadius: '4px' };

  return (
    <div style={containerStyle}>
      {loading && (
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.5)',
          color: 'white',
          padding: '10px',
          borderRadius: '4px'
        }}>
          正在加载视频...
        </div>
      )}
      <video
        ref={videoRef}
        controls
        style={videoStyle}
        onError={handleVideoError}
        onLoadStart={handleLoadStart}
        onCanPlay={handleCanPlay}
        onLoadedData={handleVideoLoad}
        preload="metadata"
      >
        {videoUrl ? (
          <>
            <source src={videoUrl} type={file.mime_type} />
            <source src={videoUrl} type="video/mp4" />
          </>
        ) : (
          <>
            <source src={getFallbackVideoUrl()} type={file.mime_type} />
            <source src={getFallbackVideoUrl()} type="video/mp4" />
          </>
        )}
        您的浏览器不支持视频播放。
      </video>
      {showMeta && (
        <div style={{ 
          marginTop: '8px', 
          fontSize: '12px', 
          color: '#666',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>
            {file.original_name} ({(file.file_size / 1024 / 1024).toFixed(2)} MB)
            {videoInfo && ` | ${Math.floor(videoInfo.duration / 60)}:${String(Math.floor(videoInfo.duration % 60)).padStart(2, '0')} | ${videoInfo.width}×${videoInfo.height}`}
          </span>
          {canDownload && (
            <Button 
              size="small" 
              type="link"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
