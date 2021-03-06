import appRoot from 'app-root-path'
import { Browser, launch, Page } from 'puppeteer'

export const logger = {
  info: console.log,
}

export const screenshot: any = null
export const store: any = null

export class taskableEnv {
  taskId: string
  page: Page
  resolve: any
  steps: Array<any>
  step: any
  currentStep: number
  taskableContext: taskableContext
  constructor(taskId: string, page: Page, resolve: any) {
    this.taskId = taskId
    this.page = page
    this.resolve = resolve
    this.steps = []
    this.step = { logs: [] }
    this.currentStep = 0

    this.newStep = this.newStep.bind(this)
    this.stepComplete = this.stepComplete.bind(this)
    this.createStep = this.createStep.bind(this)
    this.screenshot = this.screenshot.bind(this)
    this.store = this.store.bind(this)
    this.captureLogs = this.captureLogs.bind(this)
    this.taskComplete = this.taskComplete.bind(this)
    this.fail = this.fail.bind(this)

    this.taskableContext = new taskableContext(
      page,
      this.taskComplete,
      this.screenshot,
      this.store,
      this.newStep,
      this.stepComplete,
      this.fail,
    )

    // start log capture
    this.captureLogs()
  }

  /**
   * create a new step, add it to the steps object, and set the step variables
   * returns a dictionary
   */
  newStep(): any {
    this.currentStep++
    let step = this.createStep()
    this.steps.push(step)
    this.step = step

    return step
  }

  /**
   * create a new step - set the step and push the prior step into the steps array
   */
  createStep() {
    let stepNumber: number = this.currentStep
    let resultStore: Array<any> = []
    let screenshots: Array<any> = []
    let logs: Array<any> = []
    return { stepNumber, resultStore, screenshots, logs }
  }

  async fail(err: string) {
    await this.screenshot(`error-step-${this.currentStep}`)
    this.store(err)
    console.log(err)
  }

  /**
   * Update the step of the task
   */
  async stepComplete(progress: number) {
    console.log('progress', progress)

    return new Promise((resolve) => resolve())
  }

  taskComplete() {
    console.log('complete')
    this.resolve(this.steps)
  }

  /**
   * Capture log data, and append them to the passed logs list
   */
  captureLogs() {
    const createLog = (type: string, message: string) => {
      let timestamp = new Date().getTime()
      this.step.logs.push({ timestamp, type, message })
    }

    // attach console listeners to the page, to make sure we capture the results
    this.page
      .on('console', (message) =>
        createLog('console', `${message.type().substr(0, 3).toUpperCase()} ${message.text()}`),
      )
      .on('pageerror', ({ message }) => createLog('pageerror', message))
      .on('response', (response) => createLog('response', `${response.status()} ${response.url()}`))
      .on('requestfailed', (request) => {
        createLog('requestfailed', `${request.failure()?.errorText} ${request.url()}`)
      })
  }

  async screenshot(name: string, args: any = undefined) {
    let ss = await this.page.screenshot(args)

    this.step.screenshots.push({
      name: name || `screenshot${this.step.screenshots.length}`,
      image: ss,
    })
    return ss
  }

  store(data: any) {
    this.step.resultStore.push(data)
  }
}

class taskableContext {
  page: any
  taskComplete: any
  screenshot: any
  store: any
  newStep: any
  stepComplete: any
  fail: any
  constructor(page: Page, taskComplete: any, screenshot: any, store: any, newStep: any, stepComplete: any, fail: any) {
    this.page = page
    this.taskComplete = taskComplete
    this.screenshot = screenshot
    this.store = store
    this.newStep = newStep
    this.stepComplete = stepComplete
    this.fail = fail
  }

  async run(steps: Array<step>) {
    let taskResults = []
    let stepCount = steps.length
    try {
      for (let index in steps) {
        let step = steps[index]

        // create a new step
        let envStep = this.newStep()

        let start = new Date().getTime()

        // execute the step
        let results = {}

        try {
          results = await step.run(this.page, {
            screenshot: this.screenshot,
            store: this.store,
          })
        } catch (err) {
          console.error(`step failed ${err}`)
          this.fail(err)
        }

        let end = new Date().getTime()

        // store step execution time
        envStep.executionTime = (end - start) / 1000

        // update the task step in the api
        let progress: number = (envStep.stepNumber / stepCount) * 100
        await this.stepComplete(progress)

        logger.info(`completed step ${envStep.stepNumber}, completed in ${envStep.executionTime} seconds`)

        taskResults.push(results)
      }
    } finally {
      this.taskComplete(taskResults)
    }
  }
}

export class step {
  func: any
  store: any
  screenshot: any
  constructor(func: any) {
    this.func = func
  }

  async run(page: Page, context: any) {
    // the execution context will be passed in the taskable executor
    let stepFunc = this.func.bind(context)
    return await stepFunc({ page, ...context })
  }
}

export interface TaskableStepParameters {
  page: Page
  store(data: any): any
  screenshot(name?: string, options?: any): any
}

let importedVars: any = {}

try {
  importedVars = require(`${appRoot.path}/vars.json`) || {}
} catch (e) {
  console.log('failed to load variables from vars.json')
}

export const vars: any = importedVars

export const task = {
  run: async (tasks: Array<step>) => {
    console.log('running')

    let browser: Browser = await launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"',
      ],
    })

    // start page
    let page = await browser.newPage()

    let results = await new Promise(async (resolve) => {
      let taskableEnvironment = new taskableEnv('test', page, resolve)
      await taskableEnvironment.taskableContext.run(tasks)
    })

    console.log('done', results)

    browser.close()
  },
}
