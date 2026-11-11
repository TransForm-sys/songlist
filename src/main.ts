import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
// 新布局的样式必须在 style.css 之后加载：它负责覆盖行高、外壳与侧栏
import './app-shell.css'

createApp(App).mount('#app')
