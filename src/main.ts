import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
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
    // Step 1: connect first
    await ctx.connect();

    // Step 2: wait for participant BEFORE starting session
    // This works because connect() is already done
    const participant = await ctx.waitForParticipant();

    const attrs = participant.attributes ?? {};
    console.log('✅ Participant Attributes:', JSON.stringify(attrs, null, 2));

    // Step 3: Now use metadata to build instructions
    const metadata = participant.metadata ?? '';
    console.log('✅ Participant Metadata:', metadata);

    const greetingInstructions = JSON.parse(metadata)?.greetingInstructions;
    console.log('✅ greetingInstructions Metadata:', greetingInstructions);

    const agentInstructions = JSON.parse(metadata)?.agentInstructions;
    console.log('✅ agentInstructions Metadata:', agentInstructions);

    // Step 4: Create session with the real instructions
    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'marin',
        // voice: 'coral',
        // model: '',
      }),
    });

    await session.start({
      agent: new Assistant(agentInstructions),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    // Step 5: Greet
    const handle = session.generateReply({
      instructions: greetingInstructions,
    });

    await handle.waitForPlayout();
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
