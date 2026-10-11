export const ip = process.env.HUB75_IP ?? '192.168.1.100';
export const port = process.env.HUB75_PORT ? parseInt(process.env.HUB75_PORT, 10) : 1337;
