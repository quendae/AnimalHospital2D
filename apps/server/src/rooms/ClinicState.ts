import { MapSchema, Schema, type } from "@colyseus/schema";

export class NetworkPlayer extends Schema {
  @type("string") name = "Intern";
  @type("number") x = 470;
  @type("number") y = 560;
  @type("string") carriedItem = "";
  @type("boolean") connected = true;
}

export class ClinicRoomState extends Schema {
  @type({ map: NetworkPlayer }) players = new MapSchema<NetworkPlayer>();
  @type("string") phase = "lobby";
  @type("number") remainingMs = 240_000;
  @type("number") clinicStress = 8;
  @type("number") score = 0;
}
