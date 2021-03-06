"use strict";

const Botkit = require("botkit");
const moment = require("moment-timezone");
const winston = require("winston");

require("moment-recur");

const numTrainsSchedule = 5;
const defaultIntervalDays = 7;
const defaultSlackChannel = "#release";
const msInMinute = 60000;
const dateFormat = "dddd, MMM Do";
const messageToBot = ["direct_message", "direct_mention", "mention"];

const slackApiToken = process.env.SLACK_API_TOKEN;

// Check if there is an API token
if (!slackApiToken) {
    throw Error("Please specify a SLACK_API_TOKEN");
}

const slackWebhookURL = process.env.SLACK_WEBHOOK_URL;

// Check if there is a Slack webhook URL
if (!slackWebhookURL) {
    throw Error("Please specify a SLACK_WEBHOOK_URL");
}

let slackChannel = process.env.SLACK_CHANNEL;

// Check if there is a Slack channel, otherwise set default
if (!slackChannel) {
    slackChannel = defaultSlackChannel;
}

const startDate = moment(process.env.START_DATE, "DD/MM/YYYY");

// Check if start date is valid
if (!startDate.isValid()) {
    throw Error("Invalid start date. Please set START_DATE as DD/MM/YYYY");
}

const scheduleTime = moment(process.env.SCHEDULE_TIME, "HH:mm");

// Check if schedule time is valid
if (!scheduleTime.isValid()) {
    throw Error("Invalid schedule time. Please set SCHEDULE_TIME as HH:mm");
}

let intervalDays = process.env.INTERVAL_DAYS;

// Set default for interval
if (!intervalDays) {
    intervalDays = defaultIntervalDays;
}

// Check if interval is valid
if (isNaN(intervalDays)) {
    throw Error("Invalid interval. Please specify number of days in INTERVAL_DAYS");
}

// Set up recurrence
const trainRecurrence = startDate
    .subtract(intervalDays, "days")
    .recur()
    .every(intervalDays, "days");

dropPastOccurrences(trainRecurrence);

winston.info(`Recurrence set. Next train scheduled for ${trainRecurrence.next(1)[0].format("DD/MM/YYYY")} at ${scheduleTime.format("HH:mm")}`);

// Set up slack bot controller
const controller = Botkit.slackbot({ debug: false });

// Connect the bot to a stream of messages
const announcer = controller.spawn({
    token: slackApiToken,
    incoming_webhook: { url: slackWebhookURL },
    retry: true,
}).startRTM();

controller.hears(["hi", "hello", "howdy"], messageToBot, sayHi);
controller.hears(["when", "next", "train"], messageToBot, sayNextTrain);
controller.hears(["schedule"], messageToBot, saySchedule);
controller.hears([".*"], messageToBot, sayDefault);

setInterval(() => checkForEvents(trainRecurrence), msInMinute);

/**
 * Updates a recurrence so that it only contains occurrences in the future
 * @param {object} recurrence The recurrence to work on
 * @returns {void}
 */
function dropPastOccurrences(recurrence) {
    let found = false;

    while (!found) {
        const now = moment();
        const nextDate = recurrence.next(1)[0];

        nextDate.hours(scheduleTime.hours());
        nextDate.minutes(scheduleTime.minutes());

        if (nextDate.isBefore(now)) {
            recurrence.fromDate(nextDate);
        } else {
            found = true;
        }
    }
}

/**
 * Checks if a recurring event occurs in that minute
 * @param {object} recurrence The recurrence to check
 * @returns {void}
 */
function checkForEvents(recurrence) {
    const now = moment.tz("Europe/Zurich");

    winston.info(`Checking for events at ${now.format("HH:mm:ss")}`);

    if (recurrence.matches(now) && scheduleTime.hours() === now.hours() && scheduleTime.minutes() === now.minutes()) {
        winston.info("Train about to leave.");
        sayLeaving();
        recurrence.fromDate(recurrence.next(1)[0]);
    }

    if (recurrence.matches(now.add(1, "day")) && scheduleTime.hours() === now.hours() && scheduleTime.minutes() === now.minutes()) {
        winston.info("Train leaving in one day.");
        sayOneDayBefore();
    }
}

/**
 * Says hello
 * @param {object} bot The slack bot
 * @param {string} message The message to say
 * @returns {void}
 */
function sayHi(bot, message) {
    bot.reply(
        message,
        "Hi there. How can I help you?"
    );

    winston.info(`${message.user} says hi`);
}

/**
 * Replies saying when the train is leaving
 * @param {object} bot The slack bot
 * @param {string} message The message to say
 * @returns {void}
 */
function sayNextTrain(bot, message) {
    bot.reply(
        message,
        `The next release train leaves on ${trainRecurrence.next(1)[0].format(dateFormat)} at ${scheduleTime.format("HH:mm")}.`
    );

    winston.info(`${message.user} asks for next train`);
}

/**
 * Replies with the train schedule
 * @param {object} bot The slack bot
 * @param {string} message The message to say
 * @returns {void}
 */
function saySchedule(bot, message) {
    const dates = trainRecurrence.next(numTrainsSchedule);
    let text = "The release trains leaves on the following dates: \n";

    for (let i = 0; i < dates.length; i++) {
        text += `${dates[i].format(dateFormat)} at ${scheduleTime.format("HH:mm")} \n`;
    }

    bot.reply(
        message,
        text
    );

    winston.log("info", `${message.user} asks for schedule`);
}

/**
 * Says that the train will be leaving in one day
 * @returns {void}
 */
function sayOneDayBefore() {
    announcer.sendWebhook({
        text: `The release train leaves tomorrow at ${scheduleTime.format("HH:mm")}!`,
        channel: slackChannel,
    });

    winston.log("info", "Announced: Train leaving in one day");
}

/**
 * Says that the train is leaving
 * @returns {void}
 */
function sayLeaving() {
    announcer.sendWebhook({
        text: "Choo! Choo! The release train is leaving!",
        channel: slackChannel,
    });

    winston.log("info", "Announced: Train leaving now");
}

/**
 * Default message if conductor doesn't understand the question
 * @param {object} bot The slack bot
 * @param {string} message The message to say
 * @returns {void}
 */
function sayDefault(bot, message) {
    bot.reply(
        message,
        "Does not compute... I only know about trains :blush:"
    );
}
