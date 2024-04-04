const jwt = require("jsonwebtoken");
const otpGenerator = require("otp-generator");
const crypto = require("crypto");

// const mailService = require("../services/mailer");

const User = require("../models/user");
const filterObj = require("../utils/filterObj");
const { promisify } = require("util");

const signToken = (userId) =>
  jwt.sign(
    {
      userId,
    },
    process.env.JWT_SECRET,
  );

exports.login = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      status: "error",
      message: "Both email and password are required",
    });
  }

  const userDoc = await User.findOne({ email: email }).select("+password");

  if (
    !userDoc ||
    !(await userDoc.correctPassword(password, userDoc.password))
  ) {
    res.status(404).json({
      status: "error",
      message: "Email or Password is incorrect",
    });
    return;
  }

  const token = signToken(userDoc._id);

  res.status(200).json({
    stauts: "success",
    message: "Logged in Successfully!",
    token,
    user_id: userDoc._id,
  });
};
// Signup => register - sendOTP - verifyOTP

// https://api.tawk.com/auth/register

//Register New User
exports.register = async (req, res, next) => {
  const { firstName, lastName, email, password } = req.body;

  const filteredBody = filterObj(
    req.body,
    "firstName",
    "lastName",
    "password",
    "email",
  );

  // check if a verified user with given email exists

  const existing_user = await User.findOne({ email: email });

  if (existing_user && existing_user.verified) {
    res.status(400).json({
      status: "error",
      message: "Email is already in use, Please login",
    });
  } else if (existing_user) {
    await User.findOneAndUpdate({ email: email }, filteredBody, {
      new: true,
      validateModifiedOnly: true,
    });

    req.userId = existing_user._id;
    next();
  } else {
    // if user record is not available in DB
    const new_user = await User.create(filteredBody);

    //generate OTP and send email to user
    req.userId = new_user._id;
    next();
  }
};

exports.sendOTP = async (req, res, next) => {
  const { userId } = req;
  const new_otp = otpGenerator.generate(6, {
    upperCaseAlphabets: false,
    lowerCaseAlphabets: false,
    specialChars: false,
  });

  const otp_expiry_time = Date.now() + 10 * 60 * 1000; // 10 minutes
  const userDoc = await User.findByIdAndUpdate(userId, {
    otp: new_otp,
    otp_expiry_time,
  });

  userDoc.otp = new_otp;

  await userDoc.save({ new: true, validateModifiedOnly: true });

  // TODO Send Mail
  // mailService
  //   .sendEmail({
  //     from: "rawatdevanshu22@gmail.com",
  //     to: "example@gmail.com",
  //     subject: "OTP for Tawk",
  //     text: `Your otp is ${new_otp}. this is valid for 10 minutes`,
  //   })
  //   .then(() => {})
  //   .catch((err) => {});

  res.status(200).json({
    status: "success",
    message: "OTP Sent Successfully",
  });
};

exports.verifyOTP = async (req, res, next) => {
  //verifyOTP and update user record accordingly

  const { email, otp } = req.body;

  const userDoc = await User.findOne({
    email,
    otp_expiry_time: { $gt: Date.now() },
  });

  if (!userDoc) {
    res.status(400).json({
      status: "error",
      message: "Email is Invalid or OTP expired",
    });
    return;
  }

  if (userDoc.verified) {
    return res.status(400).json({
      status: "error",
      message: "Email is already verified",
    });
  }

  if (!(await userDoc.correctOTP(otp, userDoc.otp))) {
    res.status(400).json({
      status: "error",
      message: "OTP is incorrect",
    });
    return;
  }

  // OTP is correct
  userDoc.verified = true;
  userDoc.otp = undefined;

  await userDoc.save({
    new: true,
    validateModifiedOnly: true,
  });

  const token = signToken(userDoc._id);

  res.status(200).json({
    status: "success",
    message: "OTP verified successfully",
    token,
    user_id: userDoc._id,
  });
};

exports.protect = async (req, res, next) => {
  // 1) Getting token (JWT) and check if it's there
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  } else {
    req.status(400).json({
      status: "error",
      message: "You are not logged in! Please login to get access",
    });
    return;
  }

  // 2) verification of token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) check if user still exists
  const this_user = await User.findById(decoded.userId);

  if (!this_user) {
    res.status(400).json({
      status: "error",
      message: "User doesn't exists",
    });
  }

  // 4) check if user changed their password after token was issued
  if (this_user.changedPasswordAfter(decoded.iat)) {
    res.status(400).json({
      status: "error",
      message: "User recently updated password! Please log in again",
    });
  }

  req.user = this_user;
  next();
};

//Types of routes -> Protected (Only logged in users can access these) & UnProtected

exports.forgotPassword = async (req, res, next) => {
  // 1) get user email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    res.status(404).json({
      status: "error",
      message: "There is no user with given email address",
    });
    return;
  }

  // 2) generate random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // TODO PRODUCTION => Remove console.log for resetURL;
  const resetURL = `/auth/reset-password/?token=${resetToken}`;
  try {
    // TODO => Send Emai With Reset URL
    console.log(resetURL);
    res.status(200).json({
      status: "success",
      message: "Reset Password link sent to Email",
    });
    return;
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(500).json({
      status: "error",
      message: "There was an error sending the email, Please try again later.",
    });
  }
};

exports.resetPassword = async (req, res, next) => {
  // 1) get user based on token
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.body.token)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) if token has expired or submission is out of time window
  if (!user) {
    res.status(400).json({
      status: "error",
      message: "Token is Invalid or Expired",
    });
    return;
  }

  // 3) Updated users password and set resetToken and expiry to undefined
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;

  user.passwordResetToken = undefined;
  user.passwrodResetExpires = undefined;

  await user.save();

  // 4) Log in the user and Send new JWT

  // TODO => send an email to user informing about password reset
  const token = signToken(user._id);

  res.status(200).json({
    status: "success",
    message: "Password Reset complete",
    token,
  });
};
