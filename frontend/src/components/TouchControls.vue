<script lang="ts">
import { defineComponent, PropType, ref } from 'vue'
import { InputController } from '../shared/input/input-controller'
import { InputAction } from '../shared/input/input-actions'
import { isTouchDevice } from '../shared/input/touch'

/**
 * Touch controls (B3). Same action vocabulary as the keyboard, so DAS/ARR, hold, rotation and
 * hard drop behave identically: ◀ ▶ ▼ are held actions (press fires at once, then DAS/ARR),
 * the rest are one-shot buttons.
 *
 * The component is only mounted when the primary pointer is coarse (see touch.ts), and it owns no
 * game logic — every press goes through the InputController created by GameView.
 */
export default defineComponent({
  name: 'TouchControls',
  props: {
    input: { type: Object as PropType<InputController>, required: true },
  },
  setup(props) {
    const visible = ref(isTouchDevice())
    // A second finger on the same button must not fire the action twice.
    const pressedByPointer = new Set<InputAction>()

    function holdDown(action: InputAction) {
      if (pressedByPointer.has(action)) return
      pressedByPointer.add(action)
      props.input.pressAction(action)
    }

    function holdUp(action: InputAction) {
      if (!pressedByPointer.delete(action)) return
      props.input.releaseAction(action)
    }

    function tap(action: InputAction) {
      props.input.pressAction(action)
    }

    function blockMenu(e: Event) {
      e.preventDefault()
    }

    return { visible, holdDown, holdUp, tap, blockMenu }
  },
})
</script>

<template>
  <div v-if="visible" class="touch-controls" @contextmenu="blockMenu">
    <div class="touch-cluster touch-move">
      <button
        type="button"
        class="touch-btn"
        data-touch="left"
        aria-label="Влево"
        @pointerdown="holdDown('left')"
        @pointerup="holdUp('left')"
        @pointercancel="holdUp('left')"
        @pointerleave="holdUp('left')"
      >◀</button>
      <button
        type="button"
        class="touch-btn"
        data-touch="softDrop"
        aria-label="Soft Drop"
        @pointerdown="holdDown('softDrop')"
        @pointerup="holdUp('softDrop')"
        @pointercancel="holdUp('softDrop')"
        @pointerleave="holdUp('softDrop')"
      >▼</button>
      <button
        type="button"
        class="touch-btn"
        data-touch="right"
        aria-label="Вправо"
        @pointerdown="holdDown('right')"
        @pointerup="holdUp('right')"
        @pointercancel="holdUp('right')"
        @pointerleave="holdUp('right')"
      >▶</button>
    </div>

    <div class="touch-cluster touch-actions">
      <button type="button" class="touch-btn" data-touch="rotateCCW" aria-label="Вращение против часовой" @pointerdown="tap('rotateCCW')">⟲</button>
      <button type="button" class="touch-btn" data-touch="rotateCW" aria-label="Вращение по часовой" @pointerdown="tap('rotateCW')">⟳</button>
      <button type="button" class="touch-btn touch-btn-label" data-touch="rotate180" aria-label="Поворот на 180 градусов" @pointerdown="tap('rotate180')">180°</button>
      <button type="button" class="touch-btn touch-btn-label" data-touch="hold" aria-label="Удержание" @pointerdown="tap('hold')">HOLD</button>
      <button type="button" class="touch-btn touch-btn-label" data-touch="hardDrop" aria-label="Hard Drop" @pointerdown="tap('hardDrop')">DROP</button>
    </div>
  </div>
</template>

<style scoped>
.touch-controls {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10px 12px;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  z-index: 90;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.touch-cluster {
  display: flex;
  gap: 10px;
  pointer-events: auto;
}

/* A 390 px phone cannot fit 8 buttons in one row: the action cluster moves to its own row. */
.touch-actions {
  margin-left: auto;
}

@media (max-width: 430px) {
  .touch-btn {
    width: 48px;
    height: 48px;
  }
}

.touch-btn {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  border: 2px solid rgba(0, 245, 255, 0.55);
  background: rgba(26, 26, 46, 0.72);
  color: #00f5ff;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.touch-btn-label {
  font-size: 13px;
  letter-spacing: 1px;
}

.touch-btn:active {
  background: rgba(0, 245, 255, 0.25);
  box-shadow: 0 0 14px rgba(0, 245, 255, 0.4);
}
</style>
