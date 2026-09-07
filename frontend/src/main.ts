import { createApp } from 'vue'
import { createPinia, Pinia } from 'pinia'
import App from './App.vue'

const pinia: Pinia = createPinia()
const app: ReturnType<typeof createApp> = createApp(App)
app.use(pinia)
app.mount('#app')
