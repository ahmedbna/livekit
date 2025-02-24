import logging

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    llm,
    metrics,
)
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import cartesia, openai, deepgram, silero, turn_detector


load_dotenv(dotenv_path=".env.local")
logger = logging.getLogger("voice-agent")


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()

def before_llm_callback(agent, chat_ctx: llm.ChatContext):
    logger.info(f"STT -> LLM: {chat_ctx.messages[-1].content}")
    return None

def before_tts_callback(agent, source: str):
    logger.info(f"LLM -> TTS: {source}")
    return source

async def entrypoint(ctx: JobContext):
    initial_ctx = llm.ChatContext().append(
        role="system",
        text=(
            "You are a voice assistant called BNA. Your interface with users will be voice. "
            "You should use short and concise responses, and avoiding usage of unpronouncable punctuation. "
        ),
    )

    logger.info(f"connecting to room {ctx.room.name}")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for the first participant to connect
    participant = await ctx.wait_for_participant()
    logger.info(f"starting voice assistant for participant {participant.identity}")

    # This project is configured to use Deepgram STT, OpenAI LLM and Cartesia TTS plugins
    # Other great providers exist like Cerebras, ElevenLabs, Groq, Play.ht, Rime, and more
    # Learn more and pick the best one for your app:
    # https://docs.livekit.io/agents/plugins
    agent = VoicePipelineAgent(
        vad=ctx.proc.userdata["vad"],
        # flexibility to use any models
        stt=deepgram.STT(model="nova-2-general"),
        # flexibility to use any models
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=cartesia.TTS(),
        turn_detector=turn_detector.EOUModel(),
        # minimal silence duration to consider end of turn, minimum delay for endpointing, used when turn detector believes the user is done with their turn
        min_endpointing_delay=0.5,
        # maximum delay for endpointing, used when turn detector does not believe the user is done with their turn
        max_endpointing_delay=5.0,
        # intial ChatContext with system prompt
        chat_ctx=initial_ctx,
        # whether the agent can be interrupted
        allow_interruptions=True,
        # Minimum duration of speech to consider for interruption.
        # interrupt_speech_duration=0.5,
        # Minimum number of words to consider for interruption. Defaults to 0 as this may increase the latency depending on the STT.
        interrupt_min_words=0, 
        # callback to run before LLM is called, can be used to modify chat context
        before_llm_cb=before_llm_callback,
        # callback to run before TTS is called, can be used to customize pronounciation
        before_tts_cb=before_tts_callback 
    )

    usage_collector = metrics.UsageCollector()

    @agent.on("metrics_collected")
    def on_metrics_collected(agent_metrics: metrics.AgentMetrics):
        metrics.log_metrics(agent_metrics)
        usage_collector.collect(agent_metrics)

    @agent.on("user_started_speaking")
    def on_user_started_speaking(event_data=None):
        logger.info("BNA started speaking")

    @agent.on("user_stopped_speaking")
    def on_user_stopped_speaking(event_data=None):
        logger.info("BNA stopped speaking")

    @agent.on("agent_started_speaking")
    def on_agent_started_speaking(event_data=None):
        logger.info("Agent started speaking")

    @agent.on("agent_stopped_speaking")
    def on_agent_stopped_speaking(event_data=None):
        logger.info("Agent stopped speaking")

    agent.start(ctx.room, participant)

    # The agent should be polite and greet the user when it joins :)
    await agent.say("Hey, how can I help you today?", allow_interruptions=False)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )
