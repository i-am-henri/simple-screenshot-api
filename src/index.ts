import { Hono } from 'hono'
import screenshot from './routes/screenshot'

export const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})
screenshot(app)
export default app
