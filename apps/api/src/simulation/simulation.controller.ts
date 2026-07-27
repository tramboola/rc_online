import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { SimulationService } from "./simulation.service.js";

@ApiTags("simulation")
@Controller("/v1")
export class SimulationController {
  public constructor(private readonly simulation: SimulationService) {}

  @Get("/public/status")
  public status() {
    return this.simulation.status();
  }

  @Get("/public/stream")
  public stream() {
    return this.simulation.publicStream();
  }

  @Get("/public/seasons/current")
  public season() {
    return this.simulation.season();
  }

  @Get("/public/leaderboard")
  public leaderboard() {
    return this.simulation.leaderboard();
  }

  @Get("/me")
  public me() {
    return this.simulation.me();
  }

  @Get("/catalog")
  public catalog() {
    return this.simulation.catalog();
  }

  @Get("/wallets")
  public wallet() {
    return this.simulation.wallet();
  }

  @Post("/preflight-results")
  public preflight(@Body() body: Record<string, unknown>) {
    return this.simulation.submitPreflight(body);
  }

  @Post("/queue")
  public joinQueue() {
    return this.simulation.joinQueue();
  }

  @Delete("/queue/me")
  public leaveQueue() {
    return this.simulation.leaveQueue();
  }

  @Post("/simulation/offers")
  public createOffer() {
    return this.simulation.createOffer();
  }

  @Post("/ride-offers/:id/accept")
  public acceptOffer(
    @Param("id") _offerId: string,
    @Body() body: { carId?: string },
  ) {
    return this.simulation.acceptOffer(
      body.carId ?? "40000000-0000-4000-8000-000000000001",
    );
  }

  @Get("/rides/:id")
  public ride(@Param("id") rideId: string) {
    return this.simulation.ride(rideId);
  }

  @Post("/rides/:id/negotiate")
  public negotiate(@Param("id") rideId: string) {
    return this.simulation.startNegotiation(rideId);
  }

  @Post("/rides/:id/extend")
  public extend(@Param("id") rideId: string) {
    return this.simulation.extend(rideId);
  }

  @Post("/rides/:id/end")
  public end(@Param("id") rideId: string) {
    return this.simulation.end(rideId);
  }

  @Post("/simulation/scenarios/:scenario")
  public scenario(@Param("scenario") scenario: Parameters<SimulationService["setScenario"]>[0]) {
    return this.simulation.setScenario(scenario);
  }
}
