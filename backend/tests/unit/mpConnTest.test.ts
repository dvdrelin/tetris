/**
 * The room-side link test («Тест связи»): the server answers every `conn_test` frame with the
 * counters it keeps for that socket, so the client can report what the link actually delivered.
 */
import { EventEmitter } from 'events'
import { ClientMsgType, ServerMsgType, ServerMessage } from '@neon-tetris/shared'
import { RoomServer, ClientSocket } from '../../src/servers/roomServer'

class FakeSocket extends EventEmitter implements ClientSocket {
  readyState = 1
  sent: ServerMessage[] = []
  terminated = false
  send(data: string): void { this.sent.push(JSON.parse(data) as ServerMessage) }
  close(): void { this.emit('close') }
  terminate(): void { this.terminated = true }
  emitMessage(obj: unknown): void { this.emit('message', JSON.stringify(obj)) }
  lastOf(type: ServerMsgType): any {
    const all = this.sent.filter((m) => m.type === type)
    return all[all.length - 1]
  }
}

let clock = 0
const now = () => clock

function connect(server: RoomServer): FakeSocket {
  const ws = new FakeSocket()
  server.handleConnection(ws)
  return ws
}

beforeEach(() => { clock = 1_000_000 })

test('conn_test answers with per-socket frame and byte counters', () => {
  const server = new RoomServer({ now, graceMs: 5_000 })
  const ws = connect(server)
  ws.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'Хост' } })
  const playerId = ws.lastOf(ServerMsgType.RoomCreated).payload.playerId

  ws.emitMessage({ type: ClientMsgType.ConnTest, payload: { seq: 1, total: 12, clientTs: 555 } })
  const ack = ws.lastOf(ServerMsgType.ConnTestAck).payload

  expect(ack).toMatchObject({ seq: 1, clientTs: 555, serverTs: clock, playerId })
  // create_room + conn_test in; room_created out (the ack is built from counters read before it
  // was itself written, so it does not count itself).
  expect(ack.msgsIn).toBe(2)
  expect(ack.msgsOut).toBe(1)
  expect(ack.bytesIn).toBeGreaterThan(30)
  expect(ack.bytesOut).toBeGreaterThan(20)
  // A FakeSocket has no `ws` heartbeat on it: the transport counters simply read as zero loss.
  expect(ack.transport).toEqual({ pingsSent: 0, pingsLost: 0, lastPongRttMs: null })
})

test('counters keep accumulating across a test burst and across rooms', () => {
  const server = new RoomServer({ now, graceMs: 5_000 })
  const ws = connect(server)
  ws.emitMessage({ type: ClientMsgType.CreateRoom, payload: { name: 'Хост' } })
  for (let seq = 1; seq <= 12; seq++) {
    clock += 150
    ws.emitMessage({ type: ClientMsgType.ConnTest, payload: { seq, total: 12, clientTs: clock } })
  }
  const ack = ws.lastOf(ServerMsgType.ConnTestAck).payload
  expect(ack.seq).toBe(12)
  expect(ack.msgsIn).toBe(13) // create_room + 12 probes
  expect(ack.msgsOut).toBe(12) // room_created + 11 earlier acks
})

test('a probe from a socket with no room still gets an answer (playerId null)', () => {
  const server = new RoomServer({ now, graceMs: 5_000 })
  const ws = connect(server)
  ws.emitMessage({ type: ClientMsgType.ConnTest, payload: { seq: 1, total: 1, clientTs: 1 } })
  expect(ws.lastOf(ServerMsgType.ConnTestAck).payload.playerId).toBeNull()
})
