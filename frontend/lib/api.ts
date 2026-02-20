import axios from "axios";

export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});
