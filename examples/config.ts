export const ip = process.env.HUB75_IP ?? '10.0.0.78';
export const port = process.env.HUB75_PORT ? parseInt(process.env.HUB75_PORT, 10) : 1337;
