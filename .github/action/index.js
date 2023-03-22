const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const AWS = require('aws-sdk');
AWS.config.update({
  region: 'us-east-1' // Replace with your desired region
});
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const tableName = "testTable";

const owner = "abhin1509";
const branch = "main";
const octokit = new Octokit();

const THIS_TOKEN = process.env.GITHUB_TOKEN;
const GH_TOKEN = process.env.GH_TOKEN;

const getDependencies = (arr, start) => {
  const temp = [];
  for (let i = start + 1; i < arr.length; i++) {
    if (arr[i].includes("##")) {
      break;
    }

    if (arr[i] != "") {
      temp.push(arr[i]);
    }
  }

  // dependencies are in the form of `dependency-name`
  // console.log(temp);

  let ans = [];
  if (temp.length != 0) {
    for (let dep of temp) {
      let string = dep;
      let lastPos = string.indexOf("`", 1);
      let ele = string.slice(1, lastPos);
      ans.push(ele);
    }
  }
  return ans;
};

const getTags = (arr, start) => {
  const temp = [];
  for (let i = start + 1; i < arr.length; i++) {
    if (arr[i].includes("##")) {
      break;
    }

    if (arr[i] != "") {
      temp.push(arr[i]);
    }
  }
  // console.log(temp);

  // formatting tags
  let ans = [];
  if (temp.length != 0) {
    for (let tag of temp) {
      let string = tag;
      let firstPos = string.indexOf("-", 1);
      let lastPos = string.indexOf("-informational", firstPos + 1);
      let ele = string.slice(firstPos + 1, lastPos);
      if (ele.includes("%20")) {
        ele = ele.replaceAll("%20", "-");
      }
      ans.push(ele);
    }
  }
  return ans;
};

async function updateFile() {
  try {
    // fetch latest template details
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      {
        owner: owner,
        repo: "templates",
        tree_sha: branch,
        headers: { Authorization: `Bearer ${THIS_TOKEN}` },
      }
    );
    const { tree } = data;

    // filter directories and remove .github
    const trees = tree.filter(
      (item) => item.type === "tree" && item.path != ".github"
    );

    let templates = [];
    let id = 0;
    for (let item of trees) {
      let { path, sha } = item;
      let name, description, tags, dependencies;
      name = path;

      const rmurl = `https://raw.githubusercontent.com/${owner}/templates/${branch}/${path}/README.md`;
      const res1 = await axios
        .get(rmurl, {
          responseType: "text",
        })
        .catch((error) => {
          console.error(error);
        });

      // readme content
      let contentData = res1.data;

      const info = contentData.split("\n");

      let desc = "";
      for (let i = 1; i < info.length; i++) {
        if (info[i].includes("##")) {
          break;
        }

        if (info[i] != "") {
          desc += info[i];
        }
      }
      description = desc;

      for (let i = 0; i < info.length; i++) {
        if (info[i].includes("## Dependencies")) {
          let dep = getDependencies(info, i);
          dependencies = dep;
        }

        if (info[i].includes("## Tags")) {
          let tag = getTags(info, i);
          tags = tag;
        }
      }

      id++;
      let maintainBy = "stackw3";
      templates.push({
        id,
        name,
        maintainBy,
        sha,
        description,
        tags,
        dependencies,
      });
    }

    // update from independentTemplates.json
    const indTemplatesURL = `https://raw.githubusercontent.com/${owner}/templates/${branch}/IndependentTemplates.json`;
    const indTempRes = await axios
      .get(indTemplatesURL, {
        responseType: "json",
      })
      .catch((error) => {
        console.error(error);
      });

    for (temp of indTempRes.data) {
      let { name, defaultBranch, description, tags, dependencies } = temp;
      let maintainBy = name.substring(
        name.indexOf("@") + 1,
        name.lastIndexOf("/")
      );
      let sha = defaultBranch;
      id++;
      templates.push({
        id,
        name,
        maintainBy,
        sha,
        description,
        tags,
        dependencies,
      });
    }

    let currentTemplates = new Set();
    for (temp of templates) {
      currentTemplates.add(temp.name);
    }

    console.log("currentTemplates:: ", currentTemplates);

    /* ***************************** */
    /* all current templates details */
    /* ***************************** */

    const res2 = await dynamoDB
      .scan({
        TableName: tableName,
      })
      .promise()
      .catch((error) => {
        console.error(error);
      });
    console.log("res2.Items:: ", res2.Items);

    let dbTemplates = new Set();
    for (temp of res2.Items) {
      dbTemplates.add(temp.name);
    }

    console.log("dbTemplates:: ", dbTemplates);

    /* ***************************** */
    /* old db templates details */
    /* ***************************** */

    // find common templates from both currentTemplates and dbTemplates
    let commonTemplates = new Set(
      [...currentTemplates].filter((x) => dbTemplates.has(x))
    );

    console.log("commonTemplates:: ", commonTemplates);

    // loop through the commonTemplates and check if any of the details are changed or not
    // if changed then update the details in updateTemp array
    // else do nothing
    let updateTempId = [];
    for (let name of commonTemplates) {
      let dbTemp;
      for (let temp of res2.Items) {
        if (temp.name === name) {
          dbTemp = temp;
          break;
        }
      }
      let currTemp;
      for (let temp of templates) {
        if (temp.name === name) {
          currTemp = temp;
          break;
        }
      }

      if (
        dbTemp.maintainBy !== currTemp.maintainBy ||
        dbTemp.description !== currTemp.description ||
        dbTemp.tags.toString() !== currTemp.tags.toString() ||
        dbTemp.dependencies.toString() !== currTemp.dependencies.toString()
      ) {
        console.log("db:: ", dbTemp);
        console.log("curr:: ", currTemp);
        // push dbTemp.id to updateTempId array
        updateTempId.push(dbTemp.id);
      }
    }

    console.log("updateTemplateId:: ", updateTempId);
    /*

    // delete common templates from both cuurentTemplates and dbTemplates
    for (temp of commonTemplates) {
      currentTemplates.delete(temp);
      dbTemplates.delete(temp);
    }

    // dbTemplates contains all the templates which are not in currentTemplates
    // and we need to add all the templates in dbTemplates to deleteTemp array
    let deleteTempId = [];
    dbTemplates.forEach((name) => {
      // find the id
      let nameId = res2.Items.find((temp) => temp.name === name).id;
      deleteTempId.push(nameId);
    });

    // now currentTemplates contains all the templates which are not in dbTemplates
    // so we need to add all the templates in currentTemplates to createTemp array
    let createTemp = [];
    currentTemplates.forEach((name) => {
      // generate a unique id for the template
      // TODO: push to db
      createTemp.push(temp);
    });

    //TODO: update wala db mein push kro
    //TODO: delete wala db mein push kro*/
  } catch (error) {
    console.log(error);
  }
}
updateFile();
