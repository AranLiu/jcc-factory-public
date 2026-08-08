import React from 'react';
import './LoadingDots.css';

const LoadingDots = ({ size = 'medium', color = '#1890ff', text = '' }) => {
  const sizeMap = {
    small: 4,
    medium: 6,
    large: 8
  };

  const dotSize = sizeMap[size];

  return (
    <div className="loading-dots-container">
      <div className="loading-dots" style={{ '--dot-size': `${dotSize}px`, '--dot-color': color }}>
        <div className="loading-dot"></div>
        <div className="loading-dot"></div>
        <div className="loading-dot"></div>
      </div>
      {text && <span className="loading-text" style={{ color }}>{text}</span>}
    </div>
  );
};

export default LoadingDots; 