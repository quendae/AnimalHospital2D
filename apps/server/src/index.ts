import { defineRoom, defineServer } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ClinicRoom } from "./rooms/ClinicRoom";

const port = Number(process.env.PORT ?? 2567);

const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 10_000,
  }),
  rooms: {
    clinic: defineRoom(ClinicRoom),
  },
});

server.listen(port).then(() => {
  console.log(`Animal Care Co-op server listening on :${port}`);
});
