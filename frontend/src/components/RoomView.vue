<script lang="ts">
// MP block C — the room lobby: create/join by code, roster with ready/host/seat badges, ready
// toggle (rematch after a finished match reopens the lobby), room chat, toasts for server
// notices. All game-start navigation is App-level (it watches the store's phase).
import { defineComponent, ref, watch, nextTick, onMounted } from 'vue'
import { useMultiplayerStore } from '../stores/multiplayerStore'
import { useGameStore } from '../stores/gameStore'

export default defineComponent({
  name: 'RoomView',
  emits: ['menu'],
  setup(_, { emit }) {
    const mp = useMultiplayerStore()
    const gameStore = useGameStore()
    const codeDraft = ref('')
    const chatDraft = ref('')
    const chatBox = ref<HTMLElement | null>(null)

    onMounted(() => mp.ensureConnected())

    // A room we were dropped from keeps its code in the input: rejoining is one Enter press away,
    // and the player sees which room the notice is about.
    watch(
      () => mp.lostRoomCode,
      (code) => {
        if (code && !codeDraft.value) codeDraft.value = code
      },
      { immediate: true },
    )

    function createRoom() {
      gameStore.playerName = gameStore.playerName // commit the store's normalized name
      mp.createRoom(gameStore.playerName)
    }

    function joinByCode() {
      mp.joinRoom(codeDraft.value, gameStore.playerName)
    }

    function toggleReady() {
      mp.setReady(!(mp.me?.ready ?? false))
    }

    function sendChat() {
      mp.sendChat(chatDraft.value)
      chatDraft.value = ''
    }

    // Keep the chat pinned to the newest line.
    watch(
      () => mp.room?.chat.length ?? 0,
      async () => {
        await nextTick()
        if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight
      },
    )

    function copyCode() {
      const code = mp.room?.code
      if (code) navigator.clipboard?.writeText(code).catch(() => { /* clipboard denied — the code is on screen anyway */ })
    }

    function goMenu() {
      if (mp.room) mp.leaveRoom()
      mp.disconnect()
      emit('menu')
    }

    return { mp, codeDraft, chatDraft, chatBox, createRoom, joinByCode, toggleReady, sendChat, copyCode, goMenu, kb: (n: number) => `${(n / 1024).toFixed(1)} КБ` }
  },
})
</script>

<template>
  <div class="room-view">
    <button class="back-btn" @click="goMenu">← Меню</button>

    <div v-if="!mp.room" class="room-join">
      <h2 class="mp-title">МУЛЬТИПЛЕЕР</h2>
      <div v-if="mp.lostRoomCode" class="mp-error mp-error-lost" data-testid="mp-lost-room">
        Мы потеряли место в комнате {{ mp.lostRoomCode }}: матч был закрыт, комната обновилась или
        место заняло другое окно. Введите код заново — попадёте в ту же комнату, если в ней ещё есть
        свободное место (состав и чат могут быть другими).
      </div>
      <div v-if="!mp.connected" class="mp-hint">Подключение…</div>
      <div class="join-row">
        <input
          class="code-input"
          data-testid="mp-code-input"
          v-model="codeDraft"
          maxlength="8"
          placeholder="код комнаты"
          @keyup.enter="joinByCode"
        />
        <button class="mp-btn" data-testid="mp-join" :disabled="!mp.connected" @click="joinByCode">
          Войти
        </button>
      </div>
      <button class="mp-btn mp-btn-big" data-testid="mp-create" :disabled="!mp.connected" @click="createRoom">
        Создать комнату
      </button>
      <div v-if="mp.lastError" class="mp-error" data-testid="mp-error" @click="mp.clearNotice()">
        {{ mp.lastError.message }}
      </div>
    </div>

    <div v-else class="room-body">
      <div class="room-head">
        <div class="room-code" data-testid="mp-room-code" title="Код комнаты — нажмите, чтобы скопировать"
             @click="copyCode">
          {{ mp.room.code }}
        </div>
        <div class="room-phase">
          <span v-if="mp.room.phase === 'lobby'">лобби — все готовы, жмите «Готов»</span>
          <span v-else-if="mp.room.phase === 'over'">матч окончен — «Готов» реванш</span>
        </div>
      </div>

      <div class="room-players" data-testid="mp-players">
        <div v-for="p in mp.room.players" :key="p.id" class="player-row" :class="{ me: p.id === mp.myId }">
          <span class="p-name">{{ p.name }}<span v-if="p.host" class="p-host"> 👑</span></span>
          <span class="p-badges">
            <span v-if="p.id === mp.myId" class="badge badge-me">вы</span>
            <span class="badge" :class="p.ready ? 'badge-ready' : 'badge-idle'">{{ p.ready ? 'готов' : 'ждёт' }}</span>
            <span v-if="!p.connected" class="badge badge-off">нет связи</span>
          </span>
        </div>
      </div>

      <div v-if="mp.matchOverInfo" class="mp-results" data-testid="mp-results">
        <div v-for="r in mp.matchOverInfo.results" :key="r.playerId" class="result-row">
          <span class="result-place">#{{ r.placement }}</span>
          <span class="result-name">{{ r.name }}</span>
          <span class="result-lines">{{ r.lines }} линии</span>
        </div>
      </div>

      <div class="room-actions">
        <button
          class="mp-btn mp-btn-big"
          data-testid="mp-ready"
          :class="{ ready: mp.me?.ready }"
          @click="toggleReady"
        >
          {{ mp.me?.ready ? 'Отменить готовность' : 'Готов' }}
        </button>
        <button class="mp-btn mp-btn-ghost" data-testid="mp-leave" @click="mp.leaveRoom()">Покинуть</button>
        <button
          class="mp-btn mp-btn-ghost"
          data-testid="mp-conn-test"
          :disabled="mp.connTestRunning || !mp.connected"
          title="12 кадров туда-обратно: сколько дошло, сколько потерялось, какой разброс задержки"
          @click="mp.startConnTest()"
        >
          {{ mp.connTestRunning ? 'Проверяем связь…' : 'Тест связи' }}
        </button>
      </div>

      <div v-if="mp.connTest" class="mp-results" data-testid="mp-conn-stats">
        <div class="result-row">
          <span class="result-name">Канал до сервера</span>
          <span class="result-lines">
            отправлено {{ mp.connTest.sent }}, получено {{ mp.connTest.received }}<template v-if="mp.connTest.lost">, потеряно {{ mp.connTest.lost }}</template>
          </span>
        </div>
        <div class="result-row">
          <span class="result-name">Задержка</span>
          <span class="result-lines">
            min {{ mp.connTest.minRtt }} / средн. {{ mp.connTest.avgRtt }} / max {{ mp.connTest.maxRtt }} мс · дёрганье ±{{ mp.connTest.jitter }} мс
          </span>
        </div>
        <div v-if="mp.connTest.server" class="result-row">
          <span class="result-name">Сервер</span>
          <span class="result-lines">
            принял {{ mp.connTest.server.msgsIn }} кадров ({{ kb(mp.connTest.server.bytesIn) }}), отправил {{ mp.connTest.server.msgsOut }} ({{ kb(mp.connTest.server.bytesOut) }})
          </span>
        </div>
        <div v-if="mp.connTest.server" class="result-row">
          <span class="result-name">Транспорт WS</span>
          <span class="result-lines">
            пингов {{ mp.connTest.server.transport.pingsSent }}, без ответа {{ mp.connTest.server.transport.pingsLost }}<template v-if="mp.connTest.server.transport.lastPongRttMs !== null"> · ping RTT {{ mp.connTest.server.transport.lastPongRttMs }} мс</template>
          </span>
        </div>
      </div>

      <div class="chat">
        <div class="chat-feed" ref="chatBox" data-testid="mp-chat">
          <div v-for="(m, i) in mp.room.chat" :key="i" class="chat-msg">
            <span class="chat-name">{{ m.name }}:</span> {{ m.text }}
          </div>
        </div>
        <div class="chat-row">
          <input
            class="chat-input"
            data-testid="mp-chat-input"
            v-model="chatDraft"
            maxlength="200"
            placeholder="сообщение…"
            @keyup.enter="sendChat"
          />
          <button class="mp-btn" @click="sendChat">➤</button>
        </div>
      </div>

      <div v-if="mp.lastEvent || mp.lastError" class="mp-toast" data-testid="mp-toast" @click="mp.clearNotice()">
        {{ mp.lastError ? mp.lastError.message : mp.lastEvent }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-view {
  width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border: 2px solid #00f5ff;
  border-radius: 12px;
  background: rgba(10, 10, 26, 0.85);
  box-shadow: 0 0 30px rgba(0, 245, 255, 0.25);
}
.back-btn {
  align-self: flex-start;
  background: none;
  border: none;
  color: #8aa;
  font-size: 14px;
  cursor: pointer;
}
.back-btn:hover { color: #00f5ff; }
.mp-title {
  margin: 0;
  text-align: center;
  letter-spacing: 6px;
  color: #00f5ff;
  text-shadow: 0 0 12px rgba(0, 245, 255, 0.6);
}
.mp-hint { text-align: center; color: #8aa; }
.join-row { display: flex; gap: 10px; }
.code-input, .chat-input {
  flex: 1;
  background: rgba(0, 245, 255, 0.06);
  border: 1px solid #00f5ff;
  border-radius: 8px;
  color: #e8f8ff;
  padding: 10px 12px;
  font-size: 16px;
  letter-spacing: 2px;
}
.mp-btn {
  background: rgba(0, 245, 255, 0.12);
  border: 2px solid #00f5ff;
  border-radius: 8px;
  color: #00f5ff;
  font-weight: 700;
  padding: 10px 16px;
  cursor: pointer;
}
.mp-btn:disabled { opacity: 0.4; cursor: default; }
.mp-btn:hover:not(:disabled) { box-shadow: 0 0 14px rgba(0, 245, 255, 0.4); }
.mp-btn-big { width: 100%; font-size: 17px; padding: 14px; }
.mp-btn.ready { border-color: #00ff88; color: #00ff88; box-shadow: 0 0 14px rgba(0, 255, 136, 0.35); }
.mp-btn-ghost { background: none; border-color: #556; color: #8aa; }
.mp-error {
  border: 1px solid #ff4444;
  color: #ff8888;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.room-head { display: flex; align-items: baseline; gap: 14px; justify-content: center; }
.room-code {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 10px;
  color: #ffe600;
  text-shadow: 0 0 16px rgba(255, 230, 0, 0.5);
  cursor: pointer;
}
.room-phase { color: #8aa; font-size: 13px; }
.room-players { display: flex; flex-direction: column; gap: 6px; }
.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid rgba(0, 245, 255, 0.25);
  border-radius: 8px;
  color: #cfe8ff;
}
.player-row.me { border-color: #00f5ff; }
.p-host { font-size: 13px; }
.p-badges { display: flex; gap: 6px; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid; }
.badge-ready { color: #00ff88; border-color: #00ff88; }
.badge-idle { color: #8aa; border-color: #556; }
.badge-off { color: #ff8888; border-color: #ff4444; }
.badge-me { color: #ffe600; border-color: #ffe600; }
.mp-results { border: 1px solid rgba(255, 230, 0, 0.4); border-radius: 8px; padding: 8px 12px; }
.result-row { display: flex; gap: 12px; color: #cfe8ff; }
.result-place { color: #ffe600; font-weight: 700; }
.result-lines { margin-left: auto; color: #8aa; }
.room-actions { display: flex; gap: 10px; }
.chat { display: flex; flex-direction: column; gap: 8px; }
.chat-feed {
  height: 140px;
  overflow-y: auto;
  border: 1px solid rgba(0, 245, 255, 0.2);
  border-radius: 8px;
  padding: 8px 10px;
  color: #cfe8ff;
  font-size: 13px;
}
.chat-name { color: #00f5ff; }
.chat-row { display: flex; gap: 8px; }
.mp-toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 10, 26, 0.95);
  border: 1px solid #00f5ff;
  color: #cfe8ff;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
}
</style>
