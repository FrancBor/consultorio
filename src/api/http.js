import axios from 'axios'

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 10_000,
  withCredentials: true,
})

export default http
