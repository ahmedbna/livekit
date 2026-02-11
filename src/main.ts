import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  metrics,
  voice,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Assistant } from './agent.js';

dotenv.config({ path: '.env.local' });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const metadata = JSON.parse(ctx.job.metadata);
    const agentInstructions = metadata.agentInstructions;
    const greetingInstructions = metadata.greetingInstructions;

    console.log('agentInstructions:', agentInstructions)
    console.log('greetingInstructions:', greetingInstructions)

    // Create the session
    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'marin',
      }),
    });

    // // Metrics collection
    // const usageCollector = new metrics.UsageCollector();
    // session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
    //   metrics.logMetrics(ev.metrics);
    //   usageCollector.collect(ev.metrics);
    // });

    // const logUsage = async () => {
    //   const summary = usageCollector.getSummary();
    //   console.log(`Usage: ${JSON.stringify(summary)}`);
    // };

    // ctx.addShutdownCallback(logUsage);

    // Start the session with custom agentInstructions
    await session.start({
      agent: new Assistant(agentInstructions),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    // Connect to the room
    await ctx.connect();
      
    const handle = session.generateReply({
      instructions: greetingInstructions
    });

    await handle.waitForPlayout();
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));