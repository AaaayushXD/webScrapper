const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const { getFirestore } = require("firebase-admin/firestore");
const { initializeApp, cert } = require("firebase-admin/app");
const serviceAccount = require("./serviceAccount.json");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const moment = require("moment");
const circuits = require("./circuits.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
dotenv.config();
const app = express();
app.use(express.json());
app.use(bodyParser.json());

// News Article

const scrapNewsAndStore = async () => {
  const url = process.env.NEWS_URL;
  const newsArticleRef = db.collection("newsArticles").doc("news");

  axios(url)
    .then(async (response) => {
      const html = response.data;
      const $ = cheerio.load(html);
      const newsArticle = [];
      $("#article-list")
        .find("li")
        .each(function () {
          const newsHeading = $(this).find(".leading-loose").text();
          const newsImage = $(this).find("img").attr("src");
          const url = $(this).find("a").attr("href");
          newsArticle.push({ newsHeading, newsImage, url });
        });

      await newsArticleRef.update({ newsArticle });
    })
    .catch((err) => console.log(err));
};

// Driver's Standing
const scrapeDriverStanding = async () => {
  const driversUrl = process.env.DRIVERS_STANDING;
  const driversRef = db.collection("drivers").doc("driverDetails");

  axios(driversUrl)
    .then(async (response) => {
      const html = response.data;
      const $ = cheerio.load(html);
      const driverDetail = [];

      $(".listing-items--wrapper")
        .find(".col-12")
        .each(async function () {
          const rank = $(this).find("div.listing-standing .rank").text();
          const points = $(this).find(".points .f1-wide--s").text();
          const driverFirstName = $(this)
            .find(".listing-item--name .f1--xxs")
            .text()
            .trim();
          const driverLastName = $(this)
            .find(".listing-item--name .f1-bold--s")
            .text()
            .trim();
          const driverName = driverFirstName + " " + driverLastName;
          const teamName = $(this).find(".listing-item--team").text();
          const driverImage = $(this)
            .find("picture.listing-item--photo")
            .find("source")
            .attr("data-srcset")
            .split(",")[0];

          driverDetail.push({
            rank,
            points,
            driverName,
            teamName,
            driverImage,
          });
        });
      await driversRef.update({ driverDetail });
    })
    .catch((err) => console.error(err));
};

//Team Standings
const scrapeTeamStanding = async () => {
  const teamUrl = process.env.TEAMS_STANDING;
  const teamRef = db.collection("teamInfo").doc("teamDetails");

  axios(teamUrl)
    .then(async (response) => {
      const html = response.data;
      const $ = cheerio.load(html);
      const teamInfo = [];

      $(".team-listing")
        .find(".listing-item-wrapper")
        .each(async function () {
          //team Name
          const teamName = $(this)
            .find(".listing-info")
            .find(".name .f1-color--black")
            .text()
            .trim();
          //team logo
          const teamLogo = $(this)
            .find(".listing-info")
            .find(".logo img")
            .attr("data-src");
          // car image
          const carImage = $(this)
            .find(".listing-image")
            .find(".team-car img")
            .attr("data-src");

          //TODO: team principle

          // constructor ranking
          const constructorRank = $(this)
            .find(".listing-standing")
            .find(".rank")
            .text()
            .trim();
          // constructor points
          const constructorPoints = $(this)
            .find(".listing-standing")
            .find(".points .f1-wide--s")
            .text()
            .trim();

          teamInfo.push({
            teamName,
            teamLogo,
            carImage,
            constructorRank,
            constructorPoints,
          });
        });
      await teamRef.update({ teamInfo });
    })
    .catch((err) => console.error(err));
};

// Circuit Information
const storeCircuitData = async () => {
  const circuitData = circuits.f1Circuits;
  const circuitRef = db.collection("raceInfo").doc("circuitDetails");
  circuitRef.update({ circuitData });
};

// Get Circuit Name and Image
const getCircuit = async (circuitId) => {
  const circuitsData = circuits.f1Circuits;
  const circuitInfo = circuitsData.find(
    (circuit) => circuit.circuitId === circuitId
  );
  return circuitInfo || null;
};

// get schedule from Ergast API
const getSchedule = async () => {
  const scheduleApiUrl = process.env.API_URL;
  const scheduleRef = db.collection("raceInfo").doc("scheduleDetails");

  const localDateConverter = (date, time) => {
    const dateAndTimeString = date + "T" + time;
    const utcDateTime = moment.utc(dateAndTimeString);
    const localDateAndTimeString = utcDateTime
      .add(5, "hours")
      .add(45, "minutes")
      .format("YYYY-MM-DD HH:mm:ss");

    const localDate = localDateAndTimeString.split(" ")[0];
    const localTime = localDateAndTimeString.split(" ")[1];
    return [localDate, localTime];
  };

  axios(scheduleApiUrl).then(async (response) => {
    const data = response.data.MRData;
    const scheduleInfo = [];

    // total races this season
    const totalRace = Number(data.total);
    const races = data.RaceTable.Races;
    races.forEach(async (race) => {
      const {
        round,
        raceName,
        Circuit,
        date,
        time,
        FirstPractice,
        SecondPractice,
        ThirdPractice,
        Qualifying,
        Sprint,
      } = race;

      const {
        circuitId,
        url,
        Location: { locality, country },
      } = Circuit;

      const circuitDetail = await getCircuit(circuitId);
      const circuit = { circuitDetail, url, locality, country };

      const [raceDate, raceTime] = localDateConverter(date, time) || "N/A";

      const [firstPracDate, firstPracTime] =
        localDateConverter(FirstPractice?.date, FirstPractice?.time) || "N/A";
      const [secondPracDate, secondPracTime] =
        localDateConverter(SecondPractice?.date, SecondPractice?.time) || "N/A";
      const [qualifyingDate, qualifyingTime] =
        localDateConverter(Qualifying?.date, Qualifying?.time) || "N/A";
      const normalWeekEnd =
        (ThirdPractice &&
          localDateConverter(ThirdPractice.date, ThirdPractice.time)) ||
        "N/A";

      const sprintWeekEnd =
        (Sprint && localDateConverter(Sprint.date, Sprint.time)) || "N/A";

      const raceSchedule = [
        { FirstPracticeSession: { firstPracDate, firstPracTime } },
        { SecondPracticeSession: { secondPracDate, secondPracTime } },
        normalWeekEnd
          ? {
              ThirdPracticeSession: {
                thirdPracDate: normalWeekEnd[0],
                thirdPracTime: normalWeekEnd[1],
              },
            }
          : {
              SprintSession: {
                sprintDate: sprintWeekEnd && sprintWeekEnd[0],
                sprintTime: sprintWeekEnd && sprintWeekEnd[1],
              },
            },
        { Qualifying: { qualifyingDate, qualifyingTime } },
        { GrandPrix: { raceDate, raceTime } },
      ];

      scheduleInfo.push({ round, raceName, circuit, raceSchedule });
    });
    await scheduleRef.update({ scheduleInfo });
  });
};

///get all f1 champions
const getChampions = async () => {
  const champions = [];
};

getSchedule();
storeCircuitData();
scrapeTeamStanding();
scrapNewsAndStore();
scrapeDriverStanding();

cron.schedule("0 0 * * *", async () => {
  await scrapNewsAndStore();
  await scrapeDriverStanding();
  await scrapeTeamStanding();
  await getSchedule();
});

app.listen(4001, () => console.log("done"));
