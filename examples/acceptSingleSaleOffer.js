const { GraphQLClient, gql } = require("graphql-request");
const { signLimitOrder } = require("@sorare/crypto");
const crypto = require("crypto");
const yargs = require("yargs");

const { offerId, token, jwtAud, privateKey } = yargs
  .command("acceptSingleSaleOffer", "Accept a single sale offer.")
  .option("offer-id", {
    description: "The Offer ID of the offer to accept.",
    type: "string",
    required: true,
  })
  .option("token", {
    description: "The JWT or OAuth token.",
    type: "string",
    required: true,
  })
  .option("private-key", {
    description: "Your Sorare private key",
    type: "string",
    required: true,
  })
  .option("jwt-aud", {
    description: "The JWT audience (required if using a JWT token).",
    type: "string",
  })
  .help()
  .alias("help", "h").argv;

const CurrentUser = gql`
  query CurentUserQuery {
    currentUser {
      starkKey
    }
  }
`;

const GetLimitOrders = gql`
  query GetLimitOrders($id: String!) {
    transferMarket {
      offer(id: $id) {
        blockchainId
        receiverLimitOrders {
          amountBuy
          amountSell
          expirationTimestamp
          id
          nonce
          tokenBuy
          tokenSell
          vaultIdBuy
          vaultIdSell
        }
      }
    }
  }
`;

const AcceptSingleSaleOffer = gql`
  mutation AcceptSingleSaleOffer($input: acceptOfferInput!) {
    acceptOffer(input: $input) {
      offer {
        id
      }
      errors {
        message
      }
    }
  }
`;

async function main() {
  const graphQLClient = new GraphQLClient("https://api.sorare.com/graphql", {
    headers: {
      Authorization: `Bearer ${token}`,
      "JWT-AUD": jwtAud,
      // 'APIKEY': '<YourOptionalAPIKey>'
    },
  });

  const currentUserData = await graphQLClient.request(CurrentUser);
  console.log(currentUserData);
  const starkKey = currentUserData["currentUser"]["starkKey"];
  console.log("Your starkKey is", starkKey);

  const offerData = await graphQLClient.request(GetLimitOrders, {
    id: offerId,
  });
  console.log(offerData);
  const offer = offerData["transferMarket"]["offer"];
  const limitOrders = offer["receiverLimitOrders"];
  if (!limitOrders) {
    console.error("You need to be authenticated to get LimitOrders.");
    process.exit(1);
  }
  console.log(limitOrders);

  const starkSignatures = limitOrders.map((limitOrder) => ({
    data: JSON.stringify(signLimitOrder(privateKey, limitOrder)),
    nonce: limitOrder.nonce,
    expirationTimestamp: limitOrder.expirationTimestamp,
    starkKey,
  }));
  console.log(starkSignatures);

  const acceptOfferInput = {
    starkSignatures,
    blockchainId: offer["blockchainId"],
    clientMutationId: crypto.randomBytes(8).join(""),
  };
  console.log(acceptOfferInput);
  const acceptOfferData = await graphQLClient.request(AcceptSingleSaleOffer, {
    input: acceptOfferInput,
  });
  console.log(acceptOfferData);
  const acceptOffer = acceptOfferData["acceptOffer"];

  if (acceptOffer["errors"].length > 0) {
    acceptOffer["errors"].forEach((error) => {
      console.error(error["message"]);
    });
    process.exit(2);
  }

  console.log("Success!");
}

main().catch((error) => {
  if (error?.response?.status == 404) {
    console.log(`Offer '${offerId}' doesn't exist.`);
    process.exit(2);
  }
  console.error(error);
});