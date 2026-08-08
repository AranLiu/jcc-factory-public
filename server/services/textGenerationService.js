const SCRIPT_SYSTEM_PROMPT = 'You are a professional script writer and editor. Follow the supplied integration requirements exactly.'

function buildScriptInput(integrationPrompt, draftContent) {
  return `**任务：剧本整合**

**整合要求（用户指令）：**
${integrationPrompt}

---

**待整合的剧本草稿内容：**
${draftContent}

---

请严格按照整合要求处理以上草稿内容。`
}

class TextGenerationService {
  constructor({ providerService, legacyGeminiFactory } = {}) {
    if (!providerService) {
      const { pool } = require('../config/database')
      const { AiProviderService } = require('./aiProviderService')
      providerService = new AiProviderService({ pool })
    }
    this.providerService = providerService
    this.legacyGeminiFactory = legacyGeminiFactory || (() => {
      const PythonGeminiService = require('./pythonGeminiService')
      return new PythonGeminiService()
    })
  }

  async integrateScript(integrationPrompt, draftContent, modelConfig = {}) {
    const route = await this.providerService.getTaskRoute('script_integration')
    if (!route) {
      return this.legacyGeminiFactory().integrateScript(integrationPrompt, draftContent, modelConfig)
    }

    return this.providerService.generateText(
      route.provider,
      modelConfig.systemInstruction || SCRIPT_SYSTEM_PROMPT,
      buildScriptInput(integrationPrompt, draftContent),
      route.model
    )
  }
}

let singleton

function getTextGenerationService() {
  if (!singleton) singleton = new TextGenerationService()
  return singleton
}

module.exports = {
  SCRIPT_SYSTEM_PROMPT,
  TextGenerationService,
  buildScriptInput,
  getTextGenerationService,
}
