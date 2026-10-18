// Drag to reorder a list (HTML drag and drop), shared by the layers and the timeline.

import { useState, type DragEvent } from 'react';

/**
 * `onDrop(from, over, before)`: item `from` was dropped on item `over`, on its
 * first half (`before`) or its second half. `axis` says which half counts.
 */
export function useReorder(axis: 'x' | 'y', onDrop: (from: number, over: number, before: boolean) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [mark, setMark] = useState<{ over: number; before: boolean } | null>(null);

  const isBefore = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return axis === 'x' ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
  };
  const reset = () => { setDragging(null); setMark(null); };

  const itemProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      setDragging(i);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    },
    onDragEnd: reset,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      const before = isBefore(e);
      if (mark?.over !== i || mark.before !== before) setMark({ over: i, before });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      onDrop(dragging, i, isBefore(e));
      reset();
    },
  });

  /** Classes that show what is being dragged and where it would land. */
  const marks = (i: number) =>
    (dragging === i ? ' dragging' : '') + (mark?.over === i ? (mark.before ? ' drop-before' : ' drop-after') : '');

  return { itemProps, marks };
}
