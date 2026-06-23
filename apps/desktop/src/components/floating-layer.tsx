/**
 * 通用悬浮层。
 * 负责将菜单/浮窗渲染到 document.body，避免被滚动容器或 overflow 裁剪。
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 悬浮层停靠位置。 */
export type FloatingPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

/** 悬浮层属性。 */
interface FloatingLayerProps {
  /** 是否打开。 */
  open: boolean;
  /** 锚点元素引用。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 悬浮层内容。 */
  children: React.ReactNode;
  /** 悬浮层位置。 */
  placement?: FloatingPlacement;
  /** 锚点偏移。 */
  offset?: number;
  /** 自定义 className。 */
  className?: string;
  /** 关闭回调。 */
  onClose?: () => void;
}

/**
 * 通过固定定位渲染的通用浮层。
 */
export function FloatingLayer({
  open,
  anchorRef,
  children,
  placement = 'bottom-start',
  offset = 10,
  className = '',
  onClose,
}: FloatingLayerProps): React.ReactElement | null {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setStyle(null);
      return;
    }

    /**
     * 依据锚点位置刷新浮层坐标。
     */
    const updatePosition = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const layerWidth = layerRef.current?.offsetWidth ?? 320;
      const layerHeight = layerRef.current?.offsetHeight ?? 220;
      const margin = 12;
      const preferredTop = placement.startsWith('bottom')
        ? rect.bottom + offset
        : rect.top - offset - layerHeight;
      const preferredLeft = placement.endsWith('start')
        ? rect.left
        : rect.right - layerWidth;

      const fitsBelow = rect.bottom + offset + layerHeight <= window.innerHeight - margin;
      const fitsAbove = rect.top - offset - layerHeight >= margin;
      const shouldFlipVertical = placement.startsWith('bottom') ? !fitsBelow && fitsAbove : !fitsAbove && fitsBelow;

      const unclampedTop = shouldFlipVertical
        ? (placement.startsWith('bottom') ? rect.top - offset - layerHeight : rect.bottom + offset)
        : preferredTop;
      const unclampedLeft = preferredLeft;
      const clampedTop = Math.min(
        Math.max(margin, unclampedTop),
        Math.max(margin, window.innerHeight - layerHeight - margin),
      );
      const clampedLeft = Math.min(
        Math.max(margin, unclampedLeft),
        Math.max(margin, window.innerWidth - layerWidth - margin),
      );

      const nextStyle: React.CSSProperties = {
        position: 'fixed',
        zIndex: 220,
        top: clampedTop,
        left: clampedLeft,
      };
      setStyle(nextStyle);
    };

    updatePosition();
    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, offset, open, placement]);

  useEffect(() => {
    if (!open || !onClose) return;

    /**
     * 点击锚点外部区域时关闭浮层。
     */
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      const anchor = anchorRef.current;
      if (anchor?.contains(target)) return;
      if (layerRef.current?.contains(target)) return;
      onClose();
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchorRef, onClose, open]);

  if (!open || !style) {
    return null;
  }

  return createPortal(
    <div ref={layerRef} data-wa-menu="true" data-wa-floating-layer="true" style={style} className={className}>
      {children}
    </div>,
    document.body,
  );
}
